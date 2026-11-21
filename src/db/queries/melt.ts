import { and, eq, sql } from "drizzle-orm";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  userMeltPoints,
  userPoolStates,
} from "../schema.js";
import { nativeBatch, type Db } from "../client.js";
import { RARITY_STARS, type RarityKey } from "../../domain/rarity.js";
import {
  meltPointsForRarity,
  redeemableStamina,
  validateNewMelt,
  validateRedeem,
  MELT_POINTS_PER_STAMINA,
  type MeltValidationError,
  type RedeemValidationError,
} from "../../domain/melt.js";
import { getPoolConfig } from "./gacha.js";

export interface MeltCardChoice {
  id: string;
  label: string;
}

export interface MeltCardView extends MeltCardChoice {
  memberName: string;
  photoLabel: string | null;
  groupBadge: string;
  photoNo: number;
  rarity: RarityKey;
  quantity: number;
  poolId: string;
  poolName: string;
  poolEmoji: string;
}


/** Holo and secret rarity cards are never meltable (same rule as give). */
const MELTABLE_RARITY_SQL = sql.raw(`rarity NOT IN ('holo', 'secret')`);

/** Owned-card picker for dismantling: only copies beyond the last one. */
export async function searchMeltableCards(
  db: Db,
  ownerId: string,
  prefix: string,
): Promise<MeltCardChoice[]> {
  const sanitized = prefix.replace(/[%_\\]/g, "").toLowerCase();
  const likeCondition =
    sanitized === ""
      ? sql`1 = 1`
      : sql`${members.nameLower} LIKE ${`${sanitized}%`}`;
  const results = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${groups.badge} AS group_badge, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} WHERE ${userCards.userId} = ${ownerId} AND ${userCards.quantity} >= 2 AND ${cards.enabled} = 1 AND ${MELTABLE_RARITY_SQL} AND ${likeCondition} ORDER BY ${members.nameLower}, ${cards.photoNo} LIMIT 25`,
  ]);
  const rows = (results[0]?.results ?? []) as unknown as {
    id: string;
    member_name: string;
    group_badge: string;
    photo_no: number;
    rarity: string;
  }[];
  return rows.map((row) => {
    const stars = RARITY_STARS[row.rarity as RarityKey] ?? row.rarity;
    return {
      id: row.id,
      label:
        `${stars} ${row.member_name} (${row.group_badge}) · Foto ${row.photo_no}`.slice(
          0,
          100,
        ),
    };
  });
}

interface MeltReadState {
  quantity: number;
  enabled: boolean;
  rarity: RarityKey | null;
  poolId: string | null;
}

async function readMeltState(
  db: Db,
  cardId: string,
  ownerId: string,
): Promise<MeltReadState> {
  const [cardRows, ownedRows] = await db.batch([
    db
      .select({
        enabled: cards.enabled,
        rarity: cards.rarity,
        poolId: cards.poolId,
      })
      .from(cards)
      .where(eq(cards.id, cardId))
      .limit(1),
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(and(eq(userCards.userId, ownerId), eq(userCards.cardId, cardId)))
      .limit(1),
  ]);
  const card = cardRows[0];
  return {
    quantity: ownedRows[0]?.quantity ?? 0,
    enabled: card?.enabled === true,
    rarity: (card?.rarity ?? null) as RarityKey | null,
    poolId: card?.poolId ?? null,
  };
}

export type MeltOutcome =
  | { status: "ok"; points: number; gained: number; card: MeltCardView }
  | { status: "rejected"; reason: MeltValidationError };

async function meltCardView(
  db: Db,
  cardId: string,
  ownerId: string,
): Promise<MeltCardView | null> {
  const rows = await db
    .select({
      id: cards.id,
      memberName: members.name,
      photoLabel: cards.photoLabel,
      groupBadge: groups.badge,
      photoNo: cards.photoNo,
      rarity: cards.rarity,
      quantity: userCards.quantity,
      poolId: cards.poolId,
      poolName: pools.name,
      poolEmoji: pools.emoji,
    })
    .from(userCards)
    .innerJoin(cards, eq(userCards.cardId, cards.id))
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .innerJoin(pools, eq(cards.poolId, pools.id))
    .where(and(eq(userCards.userId, ownerId), eq(userCards.cardId, cardId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const rarity = row.rarity as RarityKey;
  const stars = RARITY_STARS[rarity] ?? rarity;
  return {
    id: row.id,
    label:
      `${stars} ${row.memberName} (${row.groupBadge}) · Foto ${row.photoNo}`.slice(
        0,
        100,
      ),
    memberName: row.memberName,
    photoLabel: row.photoLabel,
    groupBadge: row.groupBadge,
    photoNo: row.photoNo,
    rarity,
    quantity: row.quantity,
    poolId: row.poolId,
    poolName: row.poolName,
    poolEmoji: row.poolEmoji,
  };
}

/**
 * Burns one duplicate copy into pool-scoped melt points. The last copy is
 * never touched (`quantity >= 2` both in validation and in the guarded
 * write, so a lost race re-reads instead of dipping into progress).
 */
export async function dismantleCard(
  db: Db,
  args: { userId: string; cardId: string; now: number },
): Promise<MeltOutcome> {
  const { userId, cardId, now } = args;
  const state = await readMeltState(db, cardId, userId);
  const error = validateNewMelt({
    ownsCard: state.quantity >= 1,
    quantity: state.quantity,
    cardEnabled: state.enabled,
    rarity: state.rarity,
  });
  if (error !== null) return { status: "rejected", reason: error };
  if (state.rarity === null || state.poolId === null) {
    return { status: "rejected", reason: "card-not-owned" };
  }
  const gained = meltPointsForRarity(state.rarity);
  // The guarded decrement is the single arbiter: it affects exactly one row
  // for the winner and zero for a lost race. The points upsert runs only
  // after the win is confirmed, so a loser never mints points.
  const writeResults = await nativeBatch(db, [
    sql`INSERT INTO users (id, created_at) VALUES (${userId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ${userId} AND card_id = ${cardId} AND quantity >= 2`,
    sql`DELETE FROM user_cards WHERE user_id = ${userId} AND card_id = ${cardId} AND quantity <= 0`,
  ]);
  const updated = writeResults[1];
  if ((updated?.meta.changes ?? 0) !== 1) {
    // Lost a race between the read batch and this write: re-read for the
    // true reason instead of guessing.
    const retry = await readMeltState(db, cardId, userId);
    const retryError = validateNewMelt({
      ownsCard: retry.quantity >= 1,
      quantity: retry.quantity,
      cardEnabled: retry.enabled,
      rarity: retry.rarity,
    });
    return { status: "rejected", reason: retryError ?? "card-not-owned" };
  }
  await nativeBatch(db, [
    sql`INSERT INTO user_melt_points (user_id, pool_id, points) VALUES (${userId}, ${state.poolId}, ${gained}) ON CONFLICT (user_id, pool_id) DO UPDATE SET points = points + ${gained}`,
  ]);
  const pointRows = await db
    .select({ points: userMeltPoints.points })
    .from(userMeltPoints)
    .where(
      and(
        eq(userMeltPoints.userId, userId),
        eq(userMeltPoints.poolId, state.poolId),
      ),
    )
    .limit(1);
  const view = await meltCardView(db, cardId, userId);
  const card: MeltCardView = view ?? {
    id: cardId,
    label: cardId,
    memberName: cardId,
    photoLabel: null,
    groupBadge: "",
    photoNo: 0,
    rarity: state.rarity,
    quantity: 0,
    poolId: state.poolId,
    poolName: state.poolId,
    poolEmoji: "",
  };
  return {
    status: "ok",
    points: pointRows[0]?.points ?? gained,
    gained,
    card,
  };
}

export type RedeemOutcome =
  | { status: "ok"; stamina: number; pointsLeft: number; staminaTotal: number }
  | { status: "rejected"; reason: RedeemValidationError };

/**
 * Converts melt points into stamina for the same pool. The stamina add is
 * uncapped (may exceed max; `normalize` trims on read).
 */
export async function redeemPointsForStamina(
  db: Db,
  args: { userId: string; poolId: string; now: number },
): Promise<RedeemOutcome> {
  const { userId, poolId, now } = args;
  const pool = await getPoolConfig(db, poolId);
  const pointRows =
    pool === null
      ? []
      : await db
          .select({ points: userMeltPoints.points })
          .from(userMeltPoints)
          .where(
            and(
              eq(userMeltPoints.userId, userId),
              eq(userMeltPoints.poolId, poolId),
            ),
          )
          .limit(1);
  const points = pointRows[0]?.points ?? 0;
  const error = validateRedeem(points, pool !== null);
  if (error !== null || pool === null) {
    return { status: "rejected", reason: error ?? "pool-not-found" };
  }
  const staminaAdd = redeemableStamina(points);
  const cost = staminaAdd * MELT_POINTS_PER_STAMINA;
  const writeResults = await nativeBatch(db, [
    sql`INSERT INTO users (id, created_at) VALUES (${userId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`INSERT OR IGNORE INTO user_pool_states (user_id, pool_id, stamina, stamina_anchor_at, last_reset_at, version, pity_wish) VALUES (${userId}, ${pool.id}, ${pool.staminaMax}, ${now}, NULL, 0, 0)`,
    sql`UPDATE user_melt_points SET points = points - ${cost} WHERE user_id = ${userId} AND pool_id = ${poolId} AND points >= ${cost}`,
    sql`UPDATE user_pool_states SET stamina = stamina + ${staminaAdd}, version = version + 1 WHERE user_id = ${userId} AND pool_id = ${poolId}`,
  ]);
  const deducted = writeResults[2];
  if ((deducted?.meta.changes ?? 0) !== 1) {
    // Lost a race: re-read the balance for the true reason.
    const retryRows = await db
      .select({ points: userMeltPoints.points })
      .from(userMeltPoints)
      .where(
        and(
          eq(userMeltPoints.userId, userId),
          eq(userMeltPoints.poolId, poolId),
        ),
      )
      .limit(1);
    const retryError = validateRedeem(retryRows[0]?.points ?? 0, true);
    return { status: "rejected", reason: retryError ?? "no-balance" };
  }
  const stateRows = await db
    .select({ stamina: userPoolStates.stamina })
    .from(userPoolStates)
    .where(
      and(
        eq(userPoolStates.userId, userId),
        eq(userPoolStates.poolId, poolId),
      ),
    )
    .limit(1);
  return { status: "ok", stamina: staminaAdd, pointsLeft: points - cost, staminaTotal: stateRows[0]?.stamina ?? staminaAdd };
}

export interface MeltBalance {
  poolId: string;
  poolName: string;
  poolEmoji: string;
  points: number;
}

/** Per-pool point balances for one user, for /status. */
export async function getMeltBalances(
  db: Db,
  userId: string,
): Promise<MeltBalance[]> {
  const rows = await db
    .select({
      poolId: userMeltPoints.poolId,
      poolName: pools.name,
      poolEmoji: pools.emoji,
      points: userMeltPoints.points,
    })
    .from(userMeltPoints)
    .innerJoin(pools, eq(userMeltPoints.poolId, pools.id))
    .where(eq(userMeltPoints.userId, userId));
  return rows;
}
