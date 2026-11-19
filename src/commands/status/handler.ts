import type {
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponse,
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
import { getStatusOverview } from "../../db/queries/gacha.js";
import { buildStatusEmbed } from "../../ui/gachaEmbed.js";
import type { WaitUntil } from "../registry.js";

export function handleStatus(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  if (userId === null) {
    return ephemeralResponse("Tidak bisa membaca identitasmu.");
  }
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const now = Math.floor(Date.now() / 1000);
        const rows = await getStatusOverview(db, userId, now);
        if (rows.length === 0) {
          await postFollowup(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Pool belum tersedia. Coba lagi nanti.", flags: 64 },
          );
          return;
        }
        await postFollowup(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          { embeds: [buildStatusEmbed(rows, userId)] },
        );
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
