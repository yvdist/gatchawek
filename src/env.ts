import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DB: D1Database;
}
