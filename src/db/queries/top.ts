import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { pools } from "../schema.js";
import { nativeBatch, type Db } from "../client.js";

export interface TopCollector {
  userId: string;
  poolId: string;
  poolName: string;
  distinctMembers: number;
  rank: number;
}

export interface TopHoloOwner {
  userId: string;
  holoTotal: number;
  rank: number;
}

export const TOP_LIMIT = 5;

export interface TopBoards {
  collectors: TopCollector[];
  holoOwners: TopHoloOwner[];
}

interface CollectorRow {
  user_id: string;
  n: number;
  pool_id: string;
  pool_name: string;
}

interface HoloRow {
  user_id: string;
  holo_total: number;
}

/**
 * SATU batch: top-5 kolektor per pool + top-5 holo global. Raw SQL via
 * nativeBatch (precedent: CAS writes in gacha.ts) because drizzle's
 * db.batch typing rejects GROUP BY builders in this version.
 */
export async function getTopBoards(db: Db): Promise<TopBoards> {
  const livePools = await db
    .select({ id: pools.id, name: pools.name })
    .from(pools)
    .where(eq(pools.enabled, true))
    .orderBy(pools.sortOrder)
    .limit(25);
  if (livePools.length === 0) return { collectors: [], holoOwners: [] };
  const stmts = [
    ...livePools.map(
      (p) =>
        sql`SELECT uc.user_id AS user_id, COUNT(DISTINCT c.member_id) AS n, ${p.id} AS pool_id, ${p.name} AS pool_name FROM user_cards uc INNER JOIN cards c ON uc.card_id = c.id WHERE c.pool_id = ${p.id} AND c.enabled = 1 GROUP BY uc.user_id ORDER BY n DESC, uc.user_id LIMIT ${TOP_LIMIT}`,
    ),
    sql`SELECT user_id, COALESCE(SUM(holo_qty), 0) AS holo_total FROM user_cards GROUP BY user_id ORDER BY holo_total DESC, user_id LIMIT ${TOP_LIMIT}`,
  ];
  const results = await nativeBatch(db, stmts);
  const collectors: TopCollector[] = [];
  livePools.forEach((p, i) => {
    const rows = (results[i]?.results ?? []) as unknown as CollectorRow[];
    rows.forEach((r, rank) => {
      collectors.push({
        userId: r.user_id,
        poolId: p.id,
        poolName: p.name,
        distinctMembers: r.n,
        rank: rank + 1,
      });
    });
  });
  const holoRows = (results[results.length - 1]?.results ??
    []) as unknown as HoloRow[];
  const holoOwners: TopHoloOwner[] = holoRows
    .filter((r) => r.holo_total > 0)
    .map((r, i) => ({
      userId: r.user_id,
      holoTotal: r.holo_total,
      rank: i + 1,
    }));
  return { collectors: collectors.slice(0, TOP_LIMIT), holoOwners };
}

// Per-pool / per-scope helpers for tests and future callers.
export async function getTopCollectors(
  db: Db,
  poolId: string,
  limit: number = TOP_LIMIT,
): Promise<TopCollector[]> {
  const { collectors } = await getTopBoards(db);
  return collectors.filter((c) => c.poolId === poolId).slice(0, limit);
}

export async function getTopHoloOwners(
  db: Db,
  limit: number = TOP_LIMIT,
): Promise<TopHoloOwner[]> {
  const { holoOwners } = await getTopBoards(db);
  return holoOwners.slice(0, limit);
}

// Rejected scope notes (plan step 5): pity counters, separate holo trading,
// and fragment/burn economies need new tables + economy design — out of
// scope for this fun batch.
