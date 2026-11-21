import {
  ApplicationCommandOptionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
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
import {
  executePull,
  getPoolConfig,
} from "../../db/queries/gacha.js";
import {
  againButton,
  buildPullEmbed,
  cardImageUrl,
} from "../../ui/gachaEmbed.js";
import { parseGachaAgainCustomId } from "../../domain/gacha.js";
import { buildWaShareText, buildWaShareUrl } from "../../domain/share.js";
import { buildWaShareRow } from "../../ui/waShare.js";
import { reportError } from "../../observability.js";
import type { WaitUntil } from "../registry.js";

export function cryptoRandom(): number {
  const words = crypto.getRandomValues(new Uint32Array(1));
  return (words[0] ?? 0) / 2 ** 32;
}

export function poolOption(
  interaction: APIChatInputApplicationCommandInteraction,
): string | null {
  const option = interaction.data.options?.find((o) => o.name === "pool");
  if (
    option === undefined ||
    option.type !== ApplicationCommandOptionType.String
  ) {
    return null;
  }
  return option.value;
}

async function followupPull(
  env: Env,
  appId: string,
  token: string,
  userId: string,
  poolId: string,
  rand: () => number,
): Promise<void> {
  const db = createDb(env);
  const now = Math.floor(Date.now() / 1000);
  const pool = await getPoolConfig(db, poolId);
  if (pool === null) {
    await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
      content: "Pool belum tersedia. Coba lagi nanti.",
      flags: 64,
    });
    return;
  }
  const outcome = await executePull(db, { userId, pool, now, rand });
  switch (outcome.status) {
    case "ok": {
      const imageUrl = cardImageUrl(env.PUBLIC_BASE_URL, outcome.card.imageFile);
      const shareUrl = buildWaShareUrl(
        buildWaShareText({
          memberName: outcome.card.memberName,
          photoLabel: outcome.card.photoLabel,
          groupName: outcome.card.groupName,
          photoNo: outcome.card.photoNo,
          photoTotal: outcome.card.photoTotal,
          serial: outcome.card.serial,
          rarity: outcome.card.rarity,
          imageUrl,
        }),
      );
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        embeds: [
          buildPullEmbed({
            poolName: pool.name,
            poolEmoji: pool.emoji,
            memberName: outcome.card.memberName,
            photoLabel: outcome.card.photoLabel,
            groupName: outcome.card.groupName,
            fullName: outcome.card.fullName,
            photoNo: outcome.card.photoNo,
            photoTotal: outcome.card.photoTotal,
            rarity: outcome.card.rarity,
            kind: outcome.kind,
            isHolo: outcome.isHolo,
            isFirstClaim: outcome.isFirstClaim,
            wishHit: outcome.wishHit,
            quantity: outcome.quantity,
            userId,
            groupOwned: outcome.groupOwned,
            groupTotal: outcome.groupTotal,
            staminaLeft: outcome.staminaLeft,
            staminaMax: pool.staminaMax,
            imageUrl,
            exp: outcome.exp,
          }),
        ],
        components: [againButton(pool.id, userId), buildWaShareRow(shareUrl)],
      });
      return;
    }
    case "empty": {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: `Stamina habis. Nambah lagi <t:${outcome.nextAt}:R>.`,
        flags: 64,
      });
      return;
    }
    case "pool-empty": {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Pool ini belum punya kartu yang bisa ditarik.",
        flags: 64,
      });
      return;
    }
    case "conflict": {
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Tarikannya bentrok, coba lagi.",
        flags: 64,
      });
      return;
    }
  }
}

async function runPullTask(
  env: Env,
  appId: string,
  token: string,
  userId: string,
  poolId: string,
  rand: () => number,
): Promise<void> {
  try {
    await followupPull(env, appId, token, userId, poolId, rand);
  } catch (e) {
    console.error("gacha pull failed:", e);
    reportError("gacha pull failed", e);
    try {
      await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "D1 sibuk/kuota habis, coba lagi.",
      });
    } catch {
      // Last resort: never let the waitUntil task throw unobserved.
    }
  }
}

export function handleGacha(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  const poolId = poolOption(interaction);
  if (userId === null || poolId === null) {
    return ephemeralResponse("Pool belum tersedia. Coba lagi nanti.");
  }
  waitUntil(
    runPullTask(
      env,
      interaction.application_id,
      interaction.token,
      userId,
      poolId,
      cryptoRandom,
    ),
  );
  return deferredResponse();
}

export function handleGachaAgain(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const target = parseGachaAgainCustomId(interaction.data.custom_id);
  if (target === null) {
    return ephemeralResponse("Tombol kedaluwarsa.");
  }
  const clicker = invokerId(interaction);
  if (clicker === null || clicker !== target.ownerId) {
    return ephemeralResponse(
      `Tombol ini milik <@${target.ownerId}>.`,
    );
  }
  waitUntil(
    runPullTask(
      env,
      interaction.application_id,
      interaction.token,
      clicker,
      target.poolId,
      cryptoRandom,
    ),
  );
  return deferredResponse();
}
