import { sql } from "drizzle-orm";
import { createDb } from "./db/client.js";
import { enqueueMessage } from "./db/queries/inject.js";
import { injectQueue } from "./db/schema.js";
import { formatBulkRejectionReply, formatRejectionReply, parseBulkSubmission, parseSubmission } from "./domain/submissions.js";
import type { Env } from "./env.js";

const API_BASE = "https://discord.com/api/v10";

interface DiscordAttachment {
  url: string;
  filename: string;
  content_type?: string | null;
}

interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  webhook_id?: string;
  author?: { id: string; bot?: boolean };
  attachments: DiscordAttachment[];
}

/** Bulk marker: message carries shared defaults + one .json attachment. */
function isBulkMessage(content: string, attachments: DiscordAttachment[]): boolean {
  return (
    /^\s*\[bulk-json\]/im.test(content) &&
    attachments.some((a) => a.filename.toLowerCase().endsWith(".json"))
  );
}

async function downloadText(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(url, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`Discord CDN ${String(res.status)} for ${url}`);
  return await res.text();
}

async function listMessages(
  token: string,
  channelId: string,
  after: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (after !== null) params.set("after", after);
  const res = await fetchFn(`${API_BASE}/channels/${channelId}/messages?${params}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Discord API ${String(res.status)} listing channel ${channelId}`);
  }
  return (await res.json()) as DiscordMessage[];
}
async function replyInvalid(
  token: string,
  channelId: string,
  messageId: string,
  errors: string[],
  bulk = false,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: bulk ? formatBulkRejectionReply(errors) : formatRejectionReply(errors),
        message_reference: { message_id: messageId },
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      console.warn(`ingest: auto-reply to ${messageId} failed HTTP ${String(res.status)}`);
      return false;
    }
    return true;
  } catch (err: unknown) {
    console.warn(`ingest: auto-reply to ${messageId} failed: ${(err as Error).message}`);
    return false;
  }
}

export interface SyncCounts {
  valid: number;
  invalid: number;
  replied: number;
}

/**
 * Pull new channel messages, validate with the shared pure parser, enqueue to
 * D1, and auto-reply once to invalid ones. Idempotent: re-polls never
 * duplicate. Shared by the 5-min cron (fallback) and the on-demand review
 * commands, so review always sees fresh submissions.
 */
export async function syncInjectChannel(
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<SyncCounts> {
  const db = createDb(env);
  const [cursor] = await db
    .select({ m: sql<string | null>`max(${injectQueue.messageId})` })
    .from(injectQueue);
  const messages = await listMessages(
    env.DISCORD_BOT_TOKEN,
    env.INGEST_CHANNEL_ID,
    cursor?.m ?? null,
    fetchFn,
  );
  const guildId = env.INGEST_GUILD_ID;
  let valid = 0;
  let invalid = 0;
  let replied = 0;
  for (const message of [...messages].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (message.author?.bot === true || message.webhook_id !== undefined) continue;
    const messageUrl = `https://discord.com/channels/${guildId}/${env.INGEST_CHANNEL_ID}/${message.id}`;
    if (isBulkMessage(message.content, message.attachments)) {
      const jsonFile = message.attachments.find((a) =>
        a.filename.toLowerCase().endsWith(".json"),
      );
      let jsonText = "";
      try {
        if (jsonFile !== undefined) {
          jsonText = await downloadText(jsonFile.url, env.DISCORD_BOT_TOKEN, fetchFn);
        }
      } catch (err: unknown) {
        console.warn(`ingest: bulk download failed: ${(err as Error).message}`);
      }
      const bulk = parseBulkSubmission({
        content: message.content,
        attachments: message.attachments.map((a) => ({
          url: a.url,
          filename: a.filename,
          contentType: a.content_type ?? null,
        })),
        guildId,
        channelId: env.INGEST_CHANNEL_ID,
        messageId: message.id,
        jsonText,
      });
      if (!bulk.ok) {
        const inserted = await enqueueMessage(db, {
          messageId: message.id,
          channelId: env.INGEST_CHANNEL_ID,
          guildId,
          authorId: message.author?.id ?? null,
          submittedAt: Date.parse(message.timestamp),
          messageUrl,
          nama: null,
          memberId: null,
          pool: null,
          grup: null,
          rarity: null,
          label: null,
          sumber: null,
          imageUrl: null,
          status: "rejected" as const,
          errors: bulk.errors.join("\n"),
        });
        if (!inserted) continue;
        invalid += 1;
        const okReply = await replyInvalid(
          env.DISCORD_BOT_TOKEN,
          env.INGEST_CHANNEL_ID,
          message.id,
          bulk.errors,
          true,
          fetchFn,
        );
        if (okReply) replied += 1;
        continue;
      }
      let bulkValid = 0;
      for (let i = 0; i < bulk.value.cards.length; i += 1) {
        const card = bulk.value.cards[i];
        if (card === undefined) continue;
        const inserted = await enqueueMessage(db, {
          messageId: `${message.id}-b${String(i + 1)}`,
          channelId: env.INGEST_CHANNEL_ID,
          guildId,
          authorId: message.author?.id ?? null,
          submittedAt: Date.parse(message.timestamp),
          messageUrl,
          nama: card.nama,
          memberId: card.memberId,
          pool: card.pool,
          grup: card.grup,
          rarity: card.rarity,
          label: card.label,
          sumber: card.sumber,
          imageUrl: card.imageUrl,
        });
        if (inserted) bulkValid += 1;
      }
      if (bulkValid === 0) continue;
      valid += bulkValid;
      continue;
    }
    const parsed = parseSubmission({
      content: message.content,
      attachments: message.attachments.map((a) => ({
        url: a.url,
        filename: a.filename,
        contentType: a.content_type ?? null,
      })),
      guildId,
      channelId: env.INGEST_CHANNEL_ID,
      messageId: message.id,
    });
    if (!parsed.ok) {
      const inserted = await enqueueMessage(db, {
        messageId: message.id,
        channelId: env.INGEST_CHANNEL_ID,
        guildId,
        authorId: message.author?.id ?? null,
        submittedAt: Date.parse(message.timestamp),
        messageUrl,
        nama: null,
        memberId: null,
        pool: null,
        grup: null,
        rarity: null,
        label: null,
        sumber: null,
        imageUrl: null,
        status: "rejected" as const,
        errors: parsed.errors.join("\n"),
      });
      if (!inserted) continue;
      invalid += 1;
      const ok = await replyInvalid(
        env.DISCORD_BOT_TOKEN,
        env.INGEST_CHANNEL_ID,
        message.id,
        parsed.errors,
        false,
        fetchFn,
      );
      if (ok) replied += 1;
      continue;
    }
    const inserted = await enqueueMessage(db, {
      messageId: message.id,
      channelId: env.INGEST_CHANNEL_ID,
      guildId,
      authorId: message.author?.id ?? null,
      submittedAt: Date.parse(message.timestamp),
      messageUrl,
      nama: parsed.value.nama,
      memberId: parsed.value.memberId,
      pool: parsed.value.pool,
      grup: parsed.value.grup,
      rarity: parsed.value.rarity,
      label: parsed.value.label,
      sumber: parsed.value.sumber,
      imageUrl: parsed.value.imageUrl,
    });
    if (!inserted) continue;
    valid += 1;
  }
  console.log(
    `ingest: ${String(valid)} valid, ${String(invalid)} invalid, ${String(replied)} replied`,
  );
  return { valid, invalid, replied };
}

/** Cloudflare Cron entry (every 5 min): thin wrapper over syncInjectChannel. */
export async function handleScheduled(env: Env): Promise<void> {
  await syncInjectChannel(env);
}
