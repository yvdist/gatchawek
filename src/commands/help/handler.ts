import {
  InteractionResponseType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import type { Env } from "../../env.js";
import { ephemeralResponse, invokerId } from "../../discord/rest.js";
import { getHelpCatalog } from "../../db/queries/koleksi.js";
import { commandDefinitions } from "../registry.js";
import { buildHelpEmbed } from "../../ui/helpEmbed.js";

export async function handleHelp(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) {
    return ephemeralResponse("Tidak bisa membaca identitasmu.");
  }
  try {
    const db = createDb(env);
    const catalog = await getHelpCatalog(db);
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        embeds: [
          buildHelpEmbed({
            userId,
            catalog,
            baseUrl: env.PUBLIC_BASE_URL,
            commands: commandDefinitions,
          }),
        ],
        allowed_mentions: { parse: [] },
      },
    };
  } catch {
    return ephemeralResponse("D1 sibuk/kuota habis, coba lagi.");
  }
}
