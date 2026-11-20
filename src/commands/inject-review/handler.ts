import {
  InteractionResponseType,
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
} from "../../discord/rest.js";
import {
  approveQueued,
  countPending,
  oldestPending,
  rejectQueued,
  type QueueRow,
} from "../../db/queries/inject.js";
import {
  buildInjectReviewEmbed,
  injectReviewButtons,
  parseInjectCustomId,
} from "../../ui/injectReviewEmbed.js";
import type { WaitUntil } from "../registry.js";

function isApprover(env: Env, userId: string): boolean {
  const raw = env.INJECT_APPROVER_IDS ?? "";
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return allow.includes(userId);
}

export async function handleInjectReview(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) return ephemeralResponse("Tidak bisa membaca identitasmu.");
  if (!isApprover(env, userId)) {
    return ephemeralResponse("Khusus kurator inject.");
  }
  const db = createDb(env);
  console.log(`inject-review: from=${userId} approver=${String(isApprover(env, userId))}`);
  let row: QueueRow | null;
  try {
    row = await oldestPending(db);
    console.log(`inject-review: oldest=${row?.messageId ?? "none"}`);
  } catch (err: unknown) {
    console.warn(`inject-review: oldestPending failed: ${(err as Error).message}`);
    return ephemeralResponse("D1 sibuk/kuota habis, coba lagi.");
  }
  if (row === null) return ephemeralResponse("Antrean kosong. 🎉");
  let pending: number;
  try {
    pending = await countPending(db);
  } catch {
    return ephemeralResponse("D1 sibuk/kuota habis, coba lagi.");
  }
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      embeds: [buildInjectReviewEmbed({ row, pendingCount: pending })],
      components: [{ type: 1, components: injectReviewButtons(row.messageId) }],
      allowed_mentions: { parse: [] },
    },
  };
}

export async function handleInjectClick(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) return ephemeralResponse("Tidak bisa membaca identitasmu.");
  if (!isApprover(env, userId)) {
    return ephemeralResponse("Khusus kurator inject.");
  }
  const parsed = parseInjectCustomId(
    "custom_id" in interaction.data ? interaction.data.custom_id : "",
  );
  if (parsed === null) return ephemeralResponse("Tombol kedaluwarsa.");
  const db = createDb(env);
  waitUntil(
    (async () => {
      try {
        if (parsed.action === "no") {
          const ok = await rejectQueued(db, parsed.messageId, userId, Date.now());
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: ok ? `❌ ${parsed.messageId} ditolak.` : "Sudah diproses orang lain." },
          );
          return;
        }
        const outcome = await approveQueued(db, parsed.messageId, userId, Date.now());
        if (outcome.status === "ok") {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              content: `✅ ${outcome.cardId} masuk katalog (foto #${String(outcome.photoNo)}, serial ${String(outcome.serial)}).`,
            },
          );
        } else {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Sudah diproses orang lain / grup tidak dikenal." },
          );
        }
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
