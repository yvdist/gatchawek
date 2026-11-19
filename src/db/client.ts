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
