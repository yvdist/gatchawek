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
import { getPoolConfig } from "../../db/queries/gacha.js";
import { redeemPointsForStamina } from "../../db/queries/melt.js";
import type { RedeemValidationError } from "../../domain/melt.js";
import { MELT_POINTS_PER_STAMINA } from "../../domain/melt.js";
import { redeemResultText } from "../../ui/meltEmbed.js";
import type { WaitUntil } from "../registry.js";

function friendlyReject(reason: RedeemValidationError): string {
  switch (reason) {
    case "no-balance":
      return `Poin kurang — butuh ${MELT_POINTS_PER_STAMINA} per stamina.`;
    case "pool-not-found":
      return "Pool belum tersedia. Coba lagi nanti.";
  }
}

export function handleRedeem(
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
            { content: friendlyReject("pool-not-found"), flags: 64 },
          );
          return;
        }
        const outcome = await redeemPointsForStamina(db, {
          userId,
          poolId,
          now,
        });
        if (outcome.status === "rejected") {
          await postFollowup(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: friendlyReject(outcome.reason), flags: 64 },
          );
          return;
        }
        await postFollowup(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            content: redeemResultText({
              userId,
              cost: outcome.stamina * MELT_POINTS_PER_STAMINA,
              stamina: outcome.stamina,
              poolEmoji: pool.emoji,
              poolName: pool.name,
              pointsLeft: outcome.pointsLeft,
              staminaTotal: outcome.staminaTotal,
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
