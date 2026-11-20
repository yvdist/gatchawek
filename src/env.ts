import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DB: D1Database;
  /** Card frames (webp) — persistent storage, survives rebuild prunes. */
  CARDS: R2Bucket;
  PUBLIC_BASE_URL: string;
  DISCORD_BOT_TOKEN: string;
  INGEST_CHANNEL_ID: string;
  INGEST_GUILD_ID: string;
  /** Comma-separated Discord user IDs allowed to approve/reject inject. */
  INJECT_APPROVER_IDS: string;
  /** Owner password for /admin (wrangler secret, never committed). */
  ADMIN_PASSWORD: string;
  /** HMAC key for admin session cookies (wrangler secret). */
  ADMIN_SECRET: string;
}
