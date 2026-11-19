import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Env } from "../env.js";
import * as schema from "./schema.js";

export type Db = DrizzleD1Database<typeof schema>;

export function createDb(env: Env): Db {
  return drizzle(env.DB, { schema });
}
