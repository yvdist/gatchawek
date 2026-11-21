import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { SQL } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "@cloudflare/workers-types";
import type { Env } from "../env.js";
import * as schema from "./schema.js";

export type Db = DrizzleD1Database<typeof schema>;

export function createDb(env: Env): Db {
  return drizzle(env.DB, { schema });
}

const batchDialect = new SQLiteAsyncDialect();

export type Batchable = { toSQL(): { sql: string; params: unknown[] } } | SQL;

function rawD1(db: Db): D1Database {
  const holder = db as unknown as { $client: D1Database };
  return holder.$client;
}

function toNative(db: Db, stmt: Batchable): D1PreparedStatement {
  const built = stmt instanceof SQL ? batchDialect.sqlToQuery(stmt) : stmt.toSQL();
  return rawD1(db).prepare(built.sql).bind(...built.params);
}
export async function nativeBatch(
  db: Db,
  statements: readonly Batchable[],
): Promise<D1Result[]> {
  return rawD1(db).batch(statements.map((s) => toNative(db, s)));
}

/**
 * D1 free-tier daily cap: every SELECT fails (account-wide) until midnight UTC.
 * Drizzle rethrows as `DrizzleQueryError` ("Failed query: ...") with the D1
 * message on `cause`, so the whole chain is checked.
 */
export function isD1DailyQuotaError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || current === undefined) return false;
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes("exceeded D1's free tier daily row read limit")) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
