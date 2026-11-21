import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import type { Env } from "../../env.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import { pickHype, sanitizeCaption } from "../../domain/pamer.js";
import {
  buildWaShareText,
  buildWaShareUrl,
  pageOrigin,
} from "../../domain/share.js";
import { buildWaShareRow } from "../../ui/waShare.js";
import {
  getShowcaseCard,
  searchShowcaseCards,
} from "../../db/queries/pamer.js";
import { buildPamerEmbed, cardImageUrl } from "../../ui/pamerEmbed.js";
import type { WaitUntil } from "../registry.js";

function stringOption(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const option = interaction.data.options?.find((o) => o.name === name);
  if (
    option === undefined ||
    option.type !== ApplicationCommandOptionType.String
  ) {
    return null;
  }
  return option.value;
}

export function cryptoRandom(): number {
  const words = crypto.getRandomValues(new Uint32Array(1));
  return (words[0] ?? 0) / 2 ** 32;
}

async function runPamerTask(
  env: Env,
  appId: string,
  token: string,
  userId: string,
  cardId: string,
  caption: string | null,
  origin: string | undefined,
): Promise<void> {
  try {
    const db = createDb(env);
    const card = await getShowcaseCard(db, userId, cardId);
    if (card === null) {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Kartu tidak ditemukan atau bukan milikmu.",
        flags: 64,
      });
      return;
    }
    const imageUrl = cardImageUrl(env.PUBLIC_BASE_URL, card.imageFile);
    const shareUrl = buildWaShareUrl(
      buildWaShareText({
        memberName: card.memberName,
        photoLabel: card.photoLabel,
        groupName: card.groupName,
        photoNo: card.photoNo,
        photoTotal: card.photoTotal,
        serial: card.serial,
        rarity: card.rarity,
        imageUrl,
        pageUrl: `${pageOrigin(origin, env.PUBLIC_BASE_URL)}/kartu/${card.id}`,
      }),
    );
    await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
      embeds: [
        buildPamerEmbed({
          userId,
          memberName: card.memberName,
          photoLabel: card.photoLabel,
          fullName: card.fullName,
          poolName: card.poolName,
          poolEmoji: card.poolEmoji,
          groupName: card.groupName,
          groupBadge: card.groupBadge,
          photoNo: card.photoNo,
          photoTotal: card.photoTotal,
          serial: card.serial,
          rarity: card.rarity,
          quantity: card.quantity,
          caption: sanitizeCaption(caption),
          hype: pickHype(card.rarity, cryptoRandom()),
          imageUrl,
        }),
      ],
      components: [buildWaShareRow(shareUrl)],
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

export function handlePamer(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
  origin?: string,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  const cardId = stringOption(interaction, "kartu");
  const caption = stringOption(interaction, "caption");
  if (userId === null || cardId === null) {
    return ephemeralResponse("Pilih kartu dari list dulu.");
  }
  waitUntil(
    runPamerTask(
      env,
      interaction.application_id,
      interaction.token,
      userId,
      cardId,
      caption,
      origin,
    ),
  );
  return deferredResponse();
}

export async function handlePamerAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: number;
    value?: string | number | boolean;
  }[];
  let typed = "";
  for (const opt of options) {
    if (opt.name === "kartu" && typeof opt.value === "string") typed = opt.value;
  }
  const owner = invokerId(interaction);
  try {
    if (owner === null) {
      return {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: { choices: [] },
      };
    }
    const db = createDb(env);
    const choices = await searchShowcaseCards(db, owner, typed);
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: {
        choices: choices.map((c) => ({ name: c.label, value: c.id })),
      },
    };
  } catch {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
}
