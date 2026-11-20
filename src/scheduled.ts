import { sql } from "drizzle-orm";
import { createDb } from "./db/client.js";
import {
  enqueueMessage,
  markRepliedInvalid,
} from "./db/queries/inject.js";
import { injectQueue } from "./db/schema.js";
import { formatRejectionReply, parseSubmission } from "./domain/submissions.js";
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

async function listMessages(
  token: string,
  channelId: string,
  after: string | null,
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (after !== null) params.set("after", after);
  const res = await fetch(`${API_BASE}/channels/${channelId}/messages?${params}`, {
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
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: formatRejectionReply(errors),
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

/**
 * Scheduled community-inject poll (Cloudflare Cron, every 5 min). Lists new
 * channel messages, validates with the shared pure parser, enqueues to D1,
 * and auto-replies once to invalid ones. Idempotent: re-polls never duplicate.
 */
export async function handleScheduled(env: Env): Promise<void> {
  const db = createDb(env);
  const [cursor] = await db
    .select({ m: sql<string | null>`max(${injectQueue.messageId})` })
    .from(injectQueue);
  const messages = await listMessages(
    env.DISCORD_BOT_TOKEN,
    env.INGEST_CHANNEL_ID,
    cursor?.m ?? null,
  );
  const guildId = env.INGEST_GUILD_ID;
  let valid = 0;
  let invalid = 0;
  let replied = 0;
  for (const message of [...messages].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (message.author?.bot === true || message.webhook_id !== undefined) continue;
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
    const inserted = await enqueueMessage(db, {
      messageId: message.id,
      channelId: env.INGEST_CHANNEL_ID,
      guildId,
      authorId: message.author?.id ?? null,
      submittedAt: Date.parse(message.timestamp),
      messageUrl: `https://discord.com/channels/${guildId}/${env.INGEST_CHANNEL_ID}/${message.id}`,
      ...(parsed.ok
        ? {
            nama: parsed.value.nama,
            memberId: parsed.value.memberId,
            pool: parsed.value.pool,
            grup: parsed.value.grup,
            rarity: parsed.value.rarity,
            label: parsed.value.label,
            sumber: parsed.value.sumber,
            imageUrl: parsed.value.imageUrl,
          }
        : {
            nama: null,
            memberId: null,
            pool: null,
            grup: null,
            rarity: null,
            label: null,
            sumber: null,
            imageUrl: null,
            errors: parsed.errors.join("\n"),
          }),
    });
    if (!inserted) continue;
    if (parsed.ok) {
      valid += 1;
    } else {
      invalid += 1;
      const ok = await replyInvalid(
        env.DISCORD_BOT_TOKEN,
        env.INGEST_CHANNEL_ID,
        message.id,
        parsed.errors,
      );
      if (ok) {
        replied += 1;
        await markRepliedInvalid(db, message.id);
      }
    }
  }
  console.log(
    `ingest: ${String(valid)} valid, ${String(invalid)} invalid, ${String(replied)} replied`,
  );
}
