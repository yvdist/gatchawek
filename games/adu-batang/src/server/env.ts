/** Bindings and vars for the game Worker. Secrets (SENTRY_DSN) are never committed. */
export interface Env {
  /** Same D1 database as the bot: legacy tables plus the new game tables. */
  DB: D1Database;
  /** Same R2 bucket as the bot: rendered card frames, read-only from the game. */
  CARDS: R2Bucket;
  GAME_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  SENTRY_DSN?: string;
}
