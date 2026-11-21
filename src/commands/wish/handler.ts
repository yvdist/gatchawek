import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import type { Env } from "../../env.js";
import { ephemeralResponse, invokerId } from "../../discord/rest.js";
import {
  addWish,
  findOwnWish,
  findWishableCard,
  getWishlist,
  listWishes,
  removeWish,
  searchWishableCards,
  type WishCard,
} from "../../db/queries/wish.js";
import { RARITY_STARS } from "../../domain/rarity.js";
import {
  MAX_WISHES_PER_POOL,
  WISH_PITY_AT,
  WISH_PITY_RATE,
} from "../../domain/wish.js";
import { reportError } from "../../observability.js";

const BUSY = "D1 sibuk/kuota habis, coba lagi.";

function kartuOption(
  interaction: APIChatInputApplicationCommandInteraction,
): string | null {
  const option = interaction.data.options?.find((o) => o.name === "kartu");
  if (option?.type !== ApplicationCommandOptionType.String) return null;
  return option.value;
}

function typedKartu(
  interaction: APIApplicationCommandAutocompleteInteraction,
): string {
  const options = (interaction.data.options ?? []) as {
    name: string;
    value?: string | number | boolean;
  }[];
  const value = options.find((o) => o.name === "kartu")?.value;
  return typeof value === "string" ? value : "";
}

function cardLine(c: WishCard): string {
  return `${RARITY_STARS[c.rarity]} **${c.name}** (${c.groupBadge})`;
}

function choices(cards: WishCard[]): APIInteractionResponse {
  return {
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: {
      choices: cards.map((c) => ({
        name: `${RARITY_STARS[c.rarity]} ${c.name} (${c.groupBadge}) · ${c.poolName}`.slice(0, 100),
        value: c.cardId,
      })),
    },
  };
}

// Replies are ephemeral: a guessed Holo name must not leak to the channel.
export async function handleWish(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  const input = kartuOption(interaction);
  if (userId === null || input === null || input.trim() === "") {
    return ephemeralResponse("Tulis nama kartu yang mau di-wish.");
  }
  try {
    const db = createDb(env);
    const card = await findWishableCard(db, input);
    if (card === "ambiguous") {
      return ephemeralResponse("Nama itu cocok dengan beberapa kartu. Pilih dari list.");
    }
    if (card === null) {
      return ephemeralResponse(
        "Kartu tidak ditemukan atau tidak bisa di-wish. Secret tidak bisa di-wish, Holo harus diketik namanya persis.",
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const outcome = await addWish(db, userId, card, now);
    if (outcome === "duplicate") {
      return ephemeralResponse(`${cardLine(card)} sudah ada di wishlist-mu.`);
    }
    if (outcome === "full") {
      return ephemeralResponse(
        `Wishlist pool ${card.poolEmoji} ${card.poolName} sudah penuh (${MAX_WISHES_PER_POOL}). Hapus satu dengan /unwish dulu.`,
      );
    }
    return ephemeralResponse(
      `🌠 ${cardLine(card)} masuk wishlist pool ${card.poolEmoji} ${card.poolName}.`,
    );
  } catch (e) {
    console.error("wish failed:", e);
    reportError("wish failed", e);
    return ephemeralResponse(BUSY);
  }
}

export async function handleUnwish(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  const input = kartuOption(interaction);
  if (userId === null || input === null) {
    return ephemeralResponse("Pilih kartu dari wishlist-mu.");
  }
  try {
    const db = createDb(env);
    const wish = await findOwnWish(db, userId, input);
    if (wish === null || !(await removeWish(db, userId, wish.cardId))) {
      return ephemeralResponse("Kartu itu tidak ada di wishlist-mu.");
    }
    return ephemeralResponse(`${cardLine(wish)} dihapus dari wishlist.`);
  } catch (e) {
    console.error("unwish failed:", e);
    reportError("unwish failed", e);
    return ephemeralResponse(BUSY);
  }
}

export async function handleWishlist(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) return ephemeralResponse("Tidak bisa membaca identitasmu.");
  try {
    const pools = await getWishlist(createDb(env), userId);
    if (pools.length === 0) {
      return ephemeralResponse("Wishlist-mu kosong. Tambah dengan /wish.");
    }
    const rate = Math.round(WISH_PITY_RATE * 100);
    const blocks = pools.map(
      (p) =>
        `${p.poolEmoji} **${p.poolName}** · pity ${p.pity}/${WISH_PITY_AT}\n` +
        p.cards.map((c) => `- ${cardLine(c)}`).join("\n"),
    );
    return ephemeralResponse(
      `🌠 **Wishlist** (maks ${MAX_WISHES_PER_POOL} per pool)\n\n${blocks.join("\n\n")}\n\n` +
        `Roll ke-${WISH_PITY_AT} di pool itu: satu wish acak naik jadi ${rate}%.`,
    );
  } catch (e) {
    console.error("wishlist failed:", e);
    reportError("wishlist failed", e);
    return ephemeralResponse(BUSY);
  }
}

export async function handleWishAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  try {
    return choices(await searchWishableCards(createDb(env), typedKartu(interaction)));
  } catch (e) {
    console.error("wish autocomplete failed:", e);
    reportError("wish autocomplete failed", e);
    return choices([]);
  }
}

export async function handleUnwishAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) return choices([]);
  try {
    const typed = typedKartu(interaction).toLowerCase();
    const own = await listWishes(createDb(env), userId);
    return choices(
      own.filter((w) => w.name.toLowerCase().includes(typed)).slice(0, 25),
    );
  } catch (e) {
    console.error("unwish autocomplete failed:", e);
    reportError("unwish autocomplete failed", e);
    return choices([]);
  }
}
