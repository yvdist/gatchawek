import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import type { Env } from "../../env.js";
import { createDb } from "../../db/client.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import {
  dismantleCard,
  searchMeltableCards,
} from "../../db/queries/melt.js";
import type { MeltValidationError } from "../../domain/melt.js";
import { buildMeltEmbed } from "../../ui/meltEmbed.js";
import type { WaitUntil } from "../registry.js";

function friendlyReject(reason: MeltValidationError): string {
  switch (reason) {
    case "last-copy":
      return "Itu copy terakhirmu — tidak bisa dilebur biar progres tidak turun.";
    case "card-hidden-rarity":
      return "Holo/Secret tidak bisa dilebur.";
    case "card-disabled":
      return "Kartu ini sudah tidak tersedia.";
    case "card-not-owned":
      return "Kartu itu bukan milikmu.";
  }
}

function optionValue(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const options = interaction.data.options ?? [];
  for (const opt of options) {
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

async function runDismantleTask(
  env: Env,
  interaction: APIChatInputApplicationCommandInteraction,
  userId: string,
  cardId: string,
): Promise<void> {
  const appId = interaction.application_id;
  const token = interaction.token;
  try {
    const db = createDb(env);
    const now = Math.floor(Date.now() / 1000);
    const outcome = await dismantleCard(db, { userId, cardId, now });
    if (outcome.status === "rejected") {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: friendlyReject(outcome.reason),
        flags: 64,
      });
      return;
    }
    await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
      embeds: [
        buildMeltEmbed({
          userId,
          memberName: outcome.card.memberName,
          photoNo: outcome.card.photoNo,
          photoLabel: outcome.card.photoLabel,
          rarity: outcome.card.rarity,
          gained: outcome.gained,
          poolEmoji: outcome.card.poolEmoji,
          poolName: outcome.card.poolName,
          points: outcome.points,
        }),
      ],
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

export function handleDismantle(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  const kartu = optionValue(interaction, "kartu");
  if (userId === null || kartu === null) {
    return ephemeralResponse("Pilih kartu dari dropdown dulu.");
  }
  waitUntil(runDismantleTask(env, interaction, userId, kartu));
  return deferredResponse();
}

export async function handleDismantleAutocomplete(
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
  const userId = invokerId(interaction);
  if (focused !== "kartu" || userId === null) {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
  try {
    const choices = await searchMeltableCards(createDb(env), userId, typed);
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
