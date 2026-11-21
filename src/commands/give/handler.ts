import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { createDb, type Db } from "../../db/client.js";
import type { Env } from "../../env.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import {
  canClickGive,
  parseGiveCustomId,
  type GiveMode,
  type GiveValidationError,
} from "../../domain/give.js";
import {
  claimGive,
  createGive,
  getGiveById,
  getGiveCardView,
  resolveGive,
  searchGiftableCards,
  type GiveRow,
} from "../../db/queries/give.js";
import { buildGiveEmbed, giveButtons } from "../../ui/giveEmbed.js";
import { cardImageUrl } from "../../ui/pamerEmbed.js";
import type { WaitUntil } from "../registry.js";

function optionValue(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const options = interaction.data.options ?? [];
  for (const opt of options) {
    if (
      opt.name === name &&
      opt.type === ApplicationCommandOptionType.User &&
      typeof opt.value === "string"
    ) {
      return opt.value;
    }
    if (
      opt.name === name &&
      opt.type === ApplicationCommandOptionType.String &&
      typeof opt.value === "string"
    ) {
      return opt.value;
    }
  }
  return null;
}

function friendlyReject(reason: GiveValidationError): string {
  switch (reason) {
    case "self-gift":
      return "Kamu tidak bisa memberi ke diri sendiri.";
    case "bot-target":
      return "Tidak bisa memberi ke bot.";
    case "card-not-owned":
      return "Kartu itu bukan milikmu.";
    case "card-hidden-rarity":
      return "Kartu Holo & Secret tidak bisa di-give.";
    case "card-disabled":
      return "Kartu ini sudah tidak tersedia.";
  }
}

interface GiveCommandArgs {
  mode: GiveMode;
  targetId: string | null;
  targetIsBot: boolean;
}

async function runGiveTask(
  env: Env,
  interaction: APIChatInputApplicationCommandInteraction,
  giverId: string,
  cardId: string,
  args: GiveCommandArgs,
): Promise<void> {
  const appId = interaction.application_id;
  const token = interaction.token;
  try {
    const db = createDb(env);
    const now = Math.floor(Date.now() / 1000);
    const outcome = await createGive(db, {
      mode: args.mode,
      giverId,
      targetId: args.targetId,
      targetIsBot: args.targetIsBot,
      cardId,
      now,
    });
    if (outcome.status === "rejected") {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: friendlyReject(outcome.reason),
        flags: 64,
      });
      return;
    }
    const card = await getGiveCardView(db, cardId);
    if (card === null) {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Kartu tidak ditemukan lagi.",
        flags: 64,
      });
      return;
    }
    const row = await getGiveById(db, outcome.giveId);
    await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
      embeds: [
        buildGiveEmbed({
          mode: args.mode,
          giverId,
          targetId: args.targetId,
          claimerId: null,
          status: "open",
          expiresAt: row?.expiresAt ?? 0,
          card,
          imageUrl: cardImageUrl(env.PUBLIC_BASE_URL, card.imageFile),
        }),
      ],
      components: [giveButtons(args.mode, outcome.giveId)],
    });
  } catch {
    try {
      await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "D1 sibuk/kuota habis, coba lagi.",
      });
    } catch {
      // Never throw out of waitUntil.
    }
  }
}

export function handleGive(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const giverId = invokerId(interaction);
  const kartu = optionValue(interaction, "kartu");
  if (giverId === null || kartu === null) {
    return ephemeralResponse("Pilih kartu dari dropdown dulu.");
  }
  waitUntil(
    runGiveTask(env, interaction, giverId, kartu, {
      mode: "public",
      targetId: null,
      targetIsBot: false,
    }),
  );
  return deferredResponse();
}

export function handleGiveTo(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const giverId = invokerId(interaction);
  const targetId = optionValue(interaction, "user");
  const kartu = optionValue(interaction, "kartu");
  if (giverId === null || targetId === null || kartu === null) {
    return ephemeralResponse("Opsi give-to tidak lengkap. Coba lagi.");
  }
  if (giverId === targetId) {
    return ephemeralResponse(friendlyReject("self-gift"));
  }
  const targetIsBot = interaction.data.resolved?.users?.[targetId]?.bot === true;
  if (targetIsBot || targetId === interaction.application_id) {
    return ephemeralResponse(friendlyReject("bot-target"));
  }
  waitUntil(
    runGiveTask(env, interaction, giverId, kartu, {
      mode: "direct",
      targetId,
      targetIsBot,
    }),
  );
  return deferredResponse();
}

export async function handleGiveAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    value?: string | number | boolean;
    focused?: boolean;
  }[];
  let focused: string | null = null;
  let typed = "";
  for (const opt of options) {
    if (opt.focused === true) {
      focused = opt.name;
      if (typeof opt.value === "string") typed = opt.value;
    }
  }
  const giverId = invokerId(interaction);
  if (focused !== "kartu" || giverId === null) {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
  try {
    const choices = await searchGiftableCards(createDb(env), giverId, typed);
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: choices.map((c) => ({ name: c.label, value: c.id })) },
    };
  } catch {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
}

async function rerenderGive(
  db: Db,
  interaction: APIMessageComponentInteraction,
  env: Env,
  giveId: string,
): Promise<void> {
  const appId = interaction.application_id;
  const token = interaction.token;
  const fresh = await getGiveById(db, giveId);
  const card = fresh === null ? null : await getGiveCardView(db, fresh.cardId);
  if (fresh === null || card === null) {
    await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
      content: "Giveaway sudah tidak tersedia.",
      embeds: [],
      components: [],
    });
    return;
  }
  await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
    embeds: [
      buildGiveEmbed({
        mode: fresh.mode,
        giverId: fresh.giverId,
        targetId: fresh.targetId,
        claimerId: fresh.claimerId,
        status: fresh.status,
        expiresAt: fresh.expiresAt,
        card,
        imageUrl: cardImageUrl(env.PUBLIC_BASE_URL, card.imageFile),
      }),
    ],
    components: fresh.status === "open" ? [giveButtons(fresh.mode, fresh.id)] : [],
  });
}

export async function handleGiveClick(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<APIInteractionResponse> {
  const parsed = parseGiveCustomId(interaction.data.custom_id);
  if (parsed === null) return ephemeralResponse("Tombol kedaluwarsa.");
  const clickerId = invokerId(interaction);
  let gateRow: GiveRow | null;
  try {
    gateRow = await getGiveById(createDb(env), parsed.giveId);
  } catch {
    return ephemeralResponse("D1 sibuk/kuota habis, coba lagi.");
  }
  if (gateRow === null) {
    return ephemeralResponse("Giveaway sudah tidak tersedia.");
  }
  if (
    clickerId === null ||
    !canClickGive(parsed.action, clickerId, gateRow.giverId, gateRow.targetId)
  ) {
    return ephemeralResponse("Tombol ini bukan untukmu.");
  }
  const appId = interaction.application_id;
  const token = interaction.token;
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const now = Math.floor(Date.now() / 1000);
        const row = await getGiveById(db, parsed.giveId);
        if (row === null) {
          await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
            content: "Giveaway sudah tidak tersedia.",
            embeds: [],
            components: [],
          });
          return;
        }
        if (parsed.action === "claim" || parsed.action === "accept") {
          // claimGive answers expired / already-resolved / giver lost stock
          // atomically; the re-render below shows the true outcome.
          await claimGive(db, parsed.giveId, clickerId, now);
        } else {
          await resolveGive(
            db,
            parsed.giveId,
            now >= row.expiresAt
              ? "expired"
              : parsed.action === "reject"
                ? "rejected"
                : "cancelled",
            now,
          );
        }
        await rerenderGive(db, interaction, env, parsed.giveId);
      } catch {
        try {
          await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
            content: "D1 sibuk/kuota habis, coba lagi.",
          });
        } catch {
          // Never throw out of waitUntil.
        }
      }
    })(),
  );
  return { type: InteractionResponseType.DeferredMessageUpdate };
}
