import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DB: D1Database;
  PUBLIC_BASE_URL: string;
  DISCORD_BOT_TOKEN: string;
  INGEST_CHANNEL_ID: string;
  INGEST_GUILD_ID: string;
  /** Comma-separated Discord user IDs allowed to approve/reject inject. */
  INJECT_APPROVER_IDS: string;
}
