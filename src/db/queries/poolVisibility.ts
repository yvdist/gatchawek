import { and, eq, sql, type SQL } from "drizzle-orm";
import { cards, groups, injectQueue, pools } from "../schema.js";

/**
 * Satu-satunya definisi "pool terlihat". `enabled` tetap berarti takedown;
 * `hidden` hanya menyembunyikan pool (dan isinya) dari bot dan admin panel
 * tanpa menghapus satu baris pun.
 */
export function visiblePool(): SQL | undefined {
  return and(eq(pools.enabled, true), eq(pools.hidden, false));
}

/** Twin raw-SQL untuk query yang sudah JOIN `pools`. */
export const VISIBLE_POOL_SQL = sql`${pools.enabled} = 1 AND ${pools.hidden} = 0`;

/** Guard baris `cards` yang tidak perlu JOIN `pools`. */
export const CARD_POOL_NOT_HIDDEN_SQL = sql`NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1)`;

/** Guard baris `groups` yang tidak perlu JOIN `pools`. */
export const GROUP_POOL_NOT_HIDDEN_SQL = sql`NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${groups.poolId} AND ${pools.hidden} = 1)`;

/** Submission tanpa pool (NULL) tetap tampil; submission pool hidden tidak. */
export const QUEUE_POOL_NOT_HIDDEN_SQL = sql`(${injectQueue.pool} IS NULL OR NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${injectQueue.pool} AND ${pools.hidden} = 1))`;
