import { sql } from "drizzle-orm";
import { cards, members, pools, userCards, users } from "../schema.js";
import type { RarityKey } from "../../domain/rarity.js";
import type { TopPoolSummary } from "../../domain/kartu.js";
import { nativeBatch, type Db } from "../client.js";
import { CARD_POOL_NOT_HIDDEN_SQL, VISIBLE_POOL_SQL } from "./poolVisibility.js";

export interface KartuProfileStats {
  readonly userCreatedAt: number | null;
  readonly firstCardAt: number | null;
  readonly totalCards: number;
  readonly uniqueMembers: number;
  readonly totalHolo: number;
  readonly highestRarity: RarityKey | null;
  readonly topMemberName: string | null;
  readonly topPool: TopPoolSummary | null;
}

/**
 * Fetches all collection & identity stats for `/kartu` in a single D1 batch.
 * 100% data-driven across enabled pools (no hardcoded pool IDs).
 */
export async function getKartuProfileStats(
  db: Db,
  userId: string,
): Promise<KartuProfileStats> {
  const results = await nativeBatch(db, [
    sql`SELECT ${users.createdAt} AS created_at FROM ${users} WHERE ${users.id} = ${userId} LIMIT 1`,
    sql`SELECT COALESCE(SUM(${userCards.quantity}), 0) AS total_cards, COUNT(DISTINCT ${cards.memberId}) AS unique_members, COALESCE(SUM(${userCards.holoQty}), 0) AS total_holo, MIN(${userCards.firstObtainedAt}) AS first_card_at FROM ${userCards} INNER JOIN ${cards} ON ${cards.id} = ${userCards.cardId} WHERE ${userCards.userId} = ${userId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${CARD_POOL_NOT_HIDDEN_SQL}`,
    sql`SELECT ${members.name} AS member_name, ${cards.rarity} AS rarity FROM ${userCards} INNER JOIN ${cards} ON ${cards.id} = ${userCards.cardId} INNER JOIN ${members} ON ${members.id} = ${cards.memberId} WHERE ${userCards.userId} = ${userId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${CARD_POOL_NOT_HIDDEN_SQL} ORDER BY CASE ${cards.rarity} WHEN 'secret' THEN 0 WHEN 'holo' THEN 1 WHEN 'ultra_rare' THEN 2 WHEN 'super_rare' THEN 3 WHEN 'rare' THEN 4 ELSE 5 END, ${userCards.holoQty} DESC, ${userCards.quantity} DESC, ${userCards.firstObtainedAt} ASC LIMIT 1`,
    sql`SELECT ${pools.name} AS pool_name, COUNT(DISTINCT ${cards.memberId}) AS owned_members, ${pools.memberCount} AS total_members FROM ${userCards} INNER JOIN ${cards} ON ${cards.id} = ${userCards.cardId} INNER JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${userCards.userId} = ${userId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${VISIBLE_POOL_SQL} GROUP BY ${pools.id} ORDER BY owned_members DESC, ${pools.sortOrder} ASC LIMIT 1`,
  ]);

  const userRow = (results[0]?.results ?? [])[0] as unknown as
    | { created_at: number | null }
    | undefined;
  const totalsRow = (results[1]?.results ?? [])[0] as unknown as
    | {
        total_cards: number | null;
        unique_members: number | null;
        total_holo: number | null;
        first_card_at: number | null;
      }
    | undefined;
  const topCardRow = (results[2]?.results ?? [])[0] as unknown as
    | { member_name: string; rarity: RarityKey }
    | undefined;
  const topPoolRow = (results[3]?.results ?? [])[0] as unknown as
    | { pool_name: string; owned_members: number; total_members: number }
    | undefined;

  return {
    userCreatedAt: userRow?.created_at ?? null,
    firstCardAt: totalsRow?.first_card_at ?? null,
    totalCards: Number(totalsRow?.total_cards ?? 0),
    uniqueMembers: Number(totalsRow?.unique_members ?? 0),
    totalHolo: Number(totalsRow?.total_holo ?? 0),
    highestRarity: topCardRow?.rarity ?? null,
    topMemberName: topCardRow?.member_name ?? null,
    topPool:
      topPoolRow !== undefined && Number(topPoolRow.owned_members) > 0
        ? {
            poolName: topPoolRow.pool_name,
            ownedMembers: Number(topPoolRow.owned_members),
            totalMembers: Number(topPoolRow.total_members),
          }
        : null,
  };
}
