import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIMessage } from "discord-api-types/v10";
import { formatRejectionReply, parseSubmission } from "./lib/submissions.js";

// Load repo .env automatically so `pnpm ingest` works without manual export.
// No-op on old Node or when CI injects env directly (existing vars win).
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // Missing .env: fall back to process.env as-is.
  }
}

const API_BASE = "https://discord.com/api/v10";

export interface IngestEnv {
  token: string;
  channelId: string;
  stateFile: string;
  pendingDir: string;
  rejectedDir: string;
}

export function loadEnv(root: string): IngestEnv {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token === undefined || token === "") {
    throw new Error(
      "DISCORD_BOT_TOKEN is empty: set a bot token in .env (needs Read Message History in the inject channel)",
    );
  }
  const channelId = process.env.INGEST_CHANNEL_ID;
  if (channelId === undefined || channelId === "") {
    throw new Error(
      "INGEST_CHANNEL_ID is empty: set the inject channel id in .env",
    );
  }
  return {
    token,
    channelId,
    stateFile:
      process.env.INGEST_STATE_FILE ?? path.join(root, "data", "ingest-state.json"),
    pendingDir: path.join(root, "data", "submissions", "pending"),
    rejectedDir: path.join(root, "data", "submissions", "rejected"),
  };
}

export async function readCursor(stateFile: string): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (typeof raw === "object" && raw !== null && "after" in raw) {
      const after: unknown = raw.after;
      if (typeof after === "string" && after !== "") return after;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchMessages(
  token: string,
  channelId: string,
  after: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<APIMessage[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (after !== null) params.set("after", after);
  const res = await fetchFn(
    `${API_BASE}/channels/${channelId}/messages?${params.toString()}`,
    { headers: { Authorization: `Bot ${token}` } },
  );
  if (res.status === 403) {
    throw new Error(
      `Discord API 403: bot token lacks View Channel / Read Message History in channel ${channelId}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Discord API ${String(res.status)} listing channel ${channelId}`);
  }
  return (await res.json()) as APIMessage[];
}

export interface IngestCounts {
  valid: number;
  invalid: number;
  replied: number;
  skipped: number;
  cursor: string | null;
}

async function replyToMessage(
  token: string,
  channelId: string,
  messageId: string,
  content: string,
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
        content,
        message_reference: { message_id: messageId },
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      console.warn(
        `warning: auto-reply to ${messageId} failed: HTTP ${String(res.status)} (stays unreplied, retried next run)`,
      );
      return false;
    }
    return true;
  } catch (err: unknown) {
    console.warn(
      `warning: auto-reply to ${messageId} failed: ${(err as Error).message} (stays unreplied, retried next run)`,
    );
    return false;
  }
}

export async function ingest(
  root: string,
  deps: {
    env?: IngestEnv;
    fetchFn?: typeof fetch;
  } = {},
): Promise<IngestCounts> {
  const env = deps.env ?? loadEnv(root);
  const fetchFn = deps.fetchFn ?? fetch;
  const after = await readCursor(env.stateFile);
  const messages = await fetchMessages(env.token, env.channelId, after, fetchFn);

  await mkdir(env.pendingDir, { recursive: true });
  await mkdir(env.rejectedDir, { recursive: true });

  let valid = 0;
  let invalid = 0;
  let replied = 0;
  let skipped = 0;
  let cursor = after;

  const guildId = process.env.INGEST_GUILD_ID ?? "unknown";
  const noReply = process.argv.includes("--no-reply");
  for (const message of [...messages].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (message.author?.bot === true || message.webhook_id !== undefined) {
      skipped += 1;
    } else {
      const parsed = parseSubmission({
        content: message.content,
        attachments: message.attachments.map((a) => ({
          url: a.url,
          filename: a.filename,
          contentType: a.content_type ?? null,
        })),
        guildId,
        channelId: env.channelId,
        messageId: message.id,
      });
      const payload = {
        messageId: message.id,
        channelId: env.channelId,
        guildId,
        authorId: message.author?.id,
        submittedAt: message.timestamp,
        messageUrl: `https://discord.com/channels/${guildId}/${env.channelId}/${message.id}`,
        ...(parsed.ok
          ? { submission: parsed.value }
          : { errors: parsed.errors, content: message.content }),
      };
      const dir = parsed.ok ? env.pendingDir : env.rejectedDir;
      const outPath = path.join(dir, `${message.id}.json`);
      try {
        await readFile(outPath, "utf8");
        skipped += 1;
      } catch {
        const record: Record<string, unknown> = { ...payload };
        if (!parsed.ok && !noReply) {
          const ok = await replyToMessage(
            env.token,
            env.channelId,
            message.id,
            formatRejectionReply(parsed.errors),
            fetchFn,
          );
          if (ok) replied += 1;
          record.replied = ok;
        }
        await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`);
        if (parsed.ok) valid += 1;
        else invalid += 1;
      }
    }
    cursor = message.id > (cursor ?? "") ? message.id : cursor;
  }

  if (cursor !== null && cursor !== after) {
    await mkdir(path.dirname(env.stateFile), { recursive: true });
    await writeFile(env.stateFile, `${JSON.stringify({ after: cursor }, null, 2)}\n`);
  }
  return { valid, invalid, replied, skipped, cursor };
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = await ingest(root);
  console.log(
    `ingested ${String(result.valid)} valid, ${String(result.invalid)} invalid, ${String(result.replied)} replied (cursor ${result.cursor ?? "none"})`,
  );
}
