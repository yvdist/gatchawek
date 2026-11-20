import {
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
  approveBulkBatch,
  countPendingBulkBatches,
  oldestPendingBulkBatch,
  rejectBulkBatch,
} from "../../db/queries/inject.js";
import {
  buildBulkReviewEmbed,
  bulkReviewButtons,
  parseBulkCustomId,
} from "../../ui/bulkReviewEmbed.js";
import { syncInjectChannel } from "../../scheduled.js";
import type { WaitUntil } from "../registry.js";
function isApprover(env: Env, userId: string): boolean {
  const raw = env.INJECT_APPROVER_IDS ?? "";
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return allow.includes(userId);
}

export async function handleBulkReview(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) return ephemeralResponse("Tidak bisa membaca identitasmu.");
  if (!isApprover(env, userId)) {
    return ephemeralResponse("Khusus kurator inject.");
  }
  const db = createDb(env);
  // Acknowledge within Discord's 3s window; sync + heavy D1 reads happen after.
  waitUntil(
    (async () => {
      try {
        try {
          await syncInjectChannel(env);
        } catch (err: unknown) {
          console.warn(`bulk-review: on-demand sync failed: ${(err as Error).message}`);
        }
        const batch = await oldestPendingBulkBatch(db);
        if (batch === null) {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Antrean bulk kosong. 🎉" },
          );
          return;
        }
        let batches = 1;
        try {
          batches = await countPendingBulkBatches(db);
        } catch {
          // Counter best-effort; batch sudah di tangan, lanjut.
        }
        await patchOriginal(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            embeds: [buildBulkReviewEmbed({ batch, batchCount: batches })],
            components: [{ type: 1, components: bulkReviewButtons(batch.baseId) }],
            allowed_mentions: { parse: [] },
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

export async function handleBulkClick(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<APIInteractionResponse> {
  const userId = invokerId(interaction);
  if (userId === null) return ephemeralResponse("Tidak bisa membaca identitasmu.");
  if (!isApprover(env, userId)) {
    return ephemeralResponse("Khusus kurator inject.");
  }
  const parsed = parseBulkCustomId(
    "custom_id" in interaction.data ? interaction.data.custom_id : "",
  );
  if (parsed === null) return ephemeralResponse("Tombol kedaluwarsa.");
  const db = createDb(env);
  waitUntil(
    (async () => {
      try {
        const batch = await oldestPendingBulkBatch(db);
        const rows =
          batch !== null && batch.baseId === parsed.baseId ? batch.rows : [];
        if (rows.length === 0) {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Batch ini sudah diproses orang lain." },
          );
          return;
        }
        if (parsed.action === "no") {
          const n = await rejectBulkBatch(db, rows, userId, Date.now());
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: `❌ ${String(n)} kartu bulk ditolak.` },
          );
          return;
        }
        const outcome = await approveBulkBatch(db, rows, userId, Date.now());
        await patchOriginal(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            content:
              outcome.skipped.length === 0
                ? `✅ ${String(outcome.approved.length)} kartu bulk masuk katalog.`
                : `✅ ${String(outcome.approved.length)} masuk, ⚠️ ${String(outcome.skipped.length)} dilewati (sudah diproses).`,
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
