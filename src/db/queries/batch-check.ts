import { sql } from "drizzle-orm";
import { users } from "../schema.js";
import type { Db } from "../client.js";

/** Proves guarded raw `db.run(sql...)` statements are batchable. */
export async function verifyBatchSupport(db: Db): Promise<boolean> {
  const results = await db.batch([
    db.run(sql`SELECT 1`),
    db.select().from(users).limit(0),
  ]);
  return results.length === 2;
}
