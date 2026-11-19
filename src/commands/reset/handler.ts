import {
  ApplicationCommandOptionType,
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
  executeReset,
  getPoolConfig,
} from "../../db/queries/gacha.js";
import { resetResultText } from "../../ui/gachaEmbed.js";
import type { WaitUntil } from "../registry.js";

export function handleReset(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  const option = interaction.data.options?.find((o) => o.name === "pool");
  const poolId =
    option !== undefined && option.type === ApplicationCommandOptionType.String
      ? option.value
      : null;
  if (userId === null || poolId === null) {
    return ephemeralResponse("Pool belum tersedia. Coba lagi nanti.");
  }
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const now = Math.floor(Date.now() / 1000);
        const pool = await getPoolConfig(db, poolId);
        if (pool === null) {
          await postFollowup(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Pool belum tersedia. Coba lagi nanti.", flags: 64 },
          );
          return;
        }
        const outcome = await executeReset(db, { userId, pool, now });
        await postFollowup(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            content:
              outcome.status === "ok"
                ? resetResultText(pool.emoji, pool.name, pool.staminaMax, {
                    status: "ok",
                  })
                : resetResultText(pool.emoji, pool.name, pool.staminaMax, {
                    status: "denied",
                    reason: outcome.reason,
                    readyAt: outcome.readyAt,
                  }),
          },
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
