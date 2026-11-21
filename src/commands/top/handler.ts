import type {
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponse,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import { getTopBoards } from "../../db/queries/top.js";
import type { Env } from "../../env.js";
import {
  deferredResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import { buildTopEmbed } from "../../ui/topEmbed.js";
import type { WaitUntil } from "../registry.js";

async function followupTop(
  env: Env,
  appId: string,
  token: string,
): Promise<void> {
  const db = createDb(env);
  const boards = await getTopBoards(db);
  await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
    embeds: [
      buildTopEmbed(boards.collectors, boards.holoOwners, boards.topLevels),
    ],
  });
}

export function handleTop(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  if (userId === null) {
    return deferredResponse();
  }
  waitUntil(
    (async () => {
      try {
        await followupTop(env, interaction.application_id, interaction.token);
      } catch {
        try {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "D1 sibuk/kuota habis, coba lagi." },
          );
        } catch {
          // Never throw out of waitUntil.
        }
      }
    })(),
  );
  return deferredResponse();
}
