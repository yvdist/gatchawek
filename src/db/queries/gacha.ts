import { and, eq, sql } from "drizzle-orm";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  userPoolStates,
} from "../schema.js";
import { nativeBatch, type Db } from "../client.js";
 import {
  RARITY_KEYS,
  pickIndex,
  pickRarity,
  type RarityKey,
} from "../../domain/rarity.js";
import {
  canReset,
  consume,
  nextTickAt,
  normalize,
  resetReadyAt,
} from "../../domain/stamina.js";
import { pullKind, type PullKind } from "../../domain/gacha.js";

export interface PoolConfig {
  id: string;
  name: string;
  emoji: string;
  staminaMax: number;
  regenIntervalSec: number;
  resetCooldownSec: number;
}

interface PoolState {
  stamina: number;
  anchorAt: number;
  lastResetAt: number | null;
  version: number;
}

function toPoolConfig(row: typeof pools.$inferSelect): PoolConfig {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    staminaMax: row.staminaMax,
    regenIntervalSec: row.regenIntervalSec,
    resetCooldownSec: row.resetCooldownSec,
  };
}

/** Null when the pool id is unknown (e.g. DB not seeded yet). */
export async function getPoolConfig(
  db: Db,
  poolId: string,
): Promise<PoolConfig | null> {
  const rows = await db
    .select()
    .from(pools)
    .where(eq(pools.id, poolId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toPoolConfig(row);
}

export async function ensureUserAndState(
  db: Db,
  userId: string,
  pool: PoolConfig,
  now: number,
): Promise<PoolState> {
  await nativeBatch(db, [
    sql`INSERT OR IGNORE INTO users (id, created_at) VALUES (${userId}, ${now})`,
    sql`INSERT OR IGNORE INTO user_pool_states (user_id, pool_id, stamina, stamina_anchor_at, last_reset_at, version) VALUES (${userId}, ${pool.id}, ${pool.staminaMax}, ${now}, NULL, 0)`,
  ]);
  const rows = await db
    .select()
    .from(userPoolStates)
    .where(
      and(
        eq(userPoolStates.userId, userId),
        eq(userPoolStates.poolId, pool.id),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("user_pool_states row missing after ensure");
  }
  return {
    stamina: row.stamina,
    anchorAt: row.staminaAnchorAt,
    lastResetAt: row.lastResetAt,
    version: row.version,
  };
}

export async function getEnabledRarities(
  db: Db,
  poolId: string,
): Promise<RarityKey[]> {
  const rows = await db
    .selectDistinct({ rarity: cards.rarity })
    .from(cards)
    .where(and(eq(cards.poolId, poolId), eq(cards.enabled, true)));
  const present = new Set<RarityKey>(rows.map((r) => r.rarity));
  return RARITY_KEYS.filter((k) => present.has(k));
}

export interface CandidateCard {
  id: string;
  memberId: string;
  groupId: string;
  serial: number;
  photoNo: number;
  rarity: RarityKey;
  imageFile: string;
  sourcePageUrl: string | null;
  memberName: string;
  fullName: string | null;
  photoTotal: number;
  groupName: string;
  groupBadge: string;
}

export async function getCandidatesByRarity(
  db: Db,
  poolId: string,
  rarity: RarityKey,
): Promise<CandidateCard[]> {
  return db
    .select({
      id: cards.id,
      memberId: cards.memberId,
      groupId: cards.groupId,
      serial: cards.serial,
      photoNo: cards.photoNo,
      rarity: cards.rarity,
      imageFile: cards.imageFile,
      sourcePageUrl: cards.sourcePageUrl,
      memberName: members.name,
      fullName: members.fullName,
      photoTotal: members.photoTotal,
      groupName: groups.name,
      groupBadge: groups.badge,
    })
    .from(cards)
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .where(
      and(
        eq(cards.poolId, poolId),
        eq(cards.rarity, rarity),
        eq(cards.enabled, true),
      ),
    )
    .orderBy(cards.id);
}

export async function readOwnership(
  db: Db,
  userId: string,
  cardId: string,
  memberId: string,
): Promise<{ quantity: number; memberOwned: boolean }> {
  const [ownRows, memberRows] = await db.batch([
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(eq(userCards.userId, userId), eq(userCards.cardId, cardId)),
      )
      .limit(1),
    db
      .select({ one: sql<number>`1` })
      .from(userCards)
      .innerJoin(cards, eq(userCards.cardId, cards.id))
      .where(
        and(eq(userCards.userId, userId), eq(cards.memberId, memberId)),
      )
      .limit(1),
  ]);
  const own = ownRows[0];
  return {
    quantity: own?.quantity ?? 0,
    memberOwned: memberRows.length > 0,
  };
}

export type PullOutcome =
  | {
      status: "ok";
      card: CandidateCard;
      kind: PullKind;
      quantity: number;
      staminaLeft: number;
      groupOwned: number;
      groupTotal: number;
    }
  | { status: "empty"; nextAt: number }
  | { status: "pool-empty" }
  | { status: "conflict" };

export async function executePull(
  db: Db,
  opts: { userId: string; pool: PoolConfig; now: number; rand: () => number },
): Promise<PullOutcome> {
  const { userId, pool, now, rand } = opts;
  const state = await ensureUserAndState(db, userId, pool, now);
  const base = { stamina: state.stamina, anchorAt: state.anchorAt };
  const consumed = consume(base, pool.staminaMax, pool.regenIntervalSec, now);
  if (consumed === null) {
    const normalized = normalize(base, pool.staminaMax, pool.regenIntervalSec, now);
    const tick = nextTickAt(normalized, pool.staminaMax, pool.regenIntervalSec);
    // Unreachable: stamina < max here, so a tick always exists.
    if (tick === null) return { status: "conflict" };
    return { status: "empty", nextAt: tick };
  }

  const rarities = await getEnabledRarities(db, pool.id);
  if (rarities.length === 0) return { status: "pool-empty" };
  const rarity = pickRarity(rand(), rarities);
  if (rarity === null) return { status: "pool-empty" };
  const candidates = await getCandidatesByRarity(db, pool.id, rarity);
  if (candidates.length === 0) return { status: "pool-empty" };
  const card = candidates[pickIndex(rand(), candidates.length)];
  if (card === undefined) return { status: "pool-empty" };

  const ownership = await readOwnership(db, userId, card.id, card.memberId);
  const kind = pullKind(ownership.quantity > 0, ownership.memberOwned);
  const newVersion = state.version + 1;
  // Guard on the PRE-state version: inside one atomic batch, either all
  // three statements see version = state.version (we win) or a concurrent
  // winner already moved it (everything no-ops). Guarding on newVersion
  // would also match the rival's increment and double-spend.
  const versionGuard = sql`(SELECT 1 FROM user_pool_states WHERE user_id = ${userId} AND pool_id = ${pool.id} AND version = ${state.version})`;
  const batchResults = await nativeBatch(db, [
    sql`INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at)
SELECT ${userId}, ${card.id}, 1, ${now}, ${now}
WHERE EXISTS ${versionGuard}
ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + 1, last_obtained_at = excluded.last_obtained_at`,
    sql`INSERT INTO pulls (user_id, pool_id, card_id, new_member, new_card, pulled_at)
SELECT ${userId}, ${pool.id}, ${card.id}, ${kind === "new-member" ? 1 : 0}, ${kind !== "duplicate" ? 1 : 0}, ${now}
WHERE EXISTS ${versionGuard}`,
    db
      .update(userPoolStates)
      .set({
        stamina: consumed.stamina,
        staminaAnchorAt: consumed.anchorAt,
        version: newVersion,
      })
      .where(
        and(
          eq(userPoolStates.userId, userId),
          eq(userPoolStates.poolId, pool.id),
          eq(userPoolStates.version, state.version),
        ),
      ),
  ]);
  const cas = batchResults[2];
  // No retry: re-running would roll a different card and spend stamina twice
  // for one user action. The loser keeps its stamina and can tap again.
  if ((cas?.meta.changes ?? 0) !== 1) return { status: "conflict" };

  const [qtyRows, ownedRows, groupRows] = await db.batch([
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, card.id)))
      .limit(1),
    db
      .select({ n: sql<number>`count(distinct ${cards.memberId})` })
      .from(userCards)
      .innerJoin(cards, eq(userCards.cardId, cards.id))
      .where(
        and(
          eq(userCards.userId, userId),
          eq(cards.groupId, card.groupId),
          eq(cards.enabled, true),
        ),
      ),
    db
      .select({ memberCount: groups.memberCount })
      .from(groups)
      .where(eq(groups.id, card.groupId))
      .limit(1),
  ]);
  // CAS won (changes === 1 above), so this row is ours.
  return {
    status: "ok",
    card,
    kind,
    quantity: qtyRows[0]?.quantity ?? ownership.quantity + 1,
    staminaLeft: consumed.stamina,
    groupOwned: ownedRows[0]?.n ?? 0,
    groupTotal: groupRows[0]?.memberCount ?? 0,
  };
}

export type ResetOutcome =
  | { status: "ok"; stamina: number }
  | { status: "denied"; reason: "full" | "cooldown"; readyAt: number };

export async function executeReset(
  db: Db,
  opts: { userId: string; pool: PoolConfig; now: number },
): Promise<ResetOutcome> {
  const { userId, pool, now } = opts;
  const state = await ensureUserAndState(db, userId, pool, now);
  const normalized = normalize(
    { stamina: state.stamina, anchorAt: state.anchorAt },
    pool.staminaMax,
    pool.regenIntervalSec,
    now,
  );
  const check = canReset(
    normalized,
    pool.staminaMax,
    state.lastResetAt,
    pool.resetCooldownSec,
    now,
  );
  if (!check.ok) {
    return { status: "denied", reason: check.reason, readyAt: check.readyAt };
  }

  const newVersion = state.version + 1;
  const [cas] = await nativeBatch(db, [
    db
      .update(userPoolStates)
      .set({
        stamina: pool.staminaMax,
        staminaAnchorAt: now,
        lastResetAt: now,
        version: newVersion,
      })
      .where(
        and(
          eq(userPoolStates.userId, userId),
          eq(userPoolStates.poolId, pool.id),
          eq(userPoolStates.version, state.version),
        ),
      ),
  ]);
  if ((cas?.meta.changes ?? 0) === 1) {
    return { status: "ok", stamina: pool.staminaMax };
  }
  const rows = await db
    .select()
    .from(userPoolStates)
    .where(
      and(
        eq(userPoolStates.userId, userId),
        eq(userPoolStates.poolId, pool.id),
      ),
    )
    .limit(1);
  const fresh = rows[0];
  // Lost a concurrent race; report a denial derived from fresh data.
  if (fresh === undefined) {
    return {
      status: "denied",
      reason: "cooldown",
      readyAt: now + pool.resetCooldownSec,
    };
  }
  const freshNormalized = normalize(
    { stamina: fresh.stamina, anchorAt: fresh.staminaAnchorAt },
    pool.staminaMax,
    pool.regenIntervalSec,
    now,
  );
  const recheck = canReset(
    freshNormalized,
    pool.staminaMax,
    fresh.lastResetAt,
    pool.resetCooldownSec,
    now,
  );
  if (!recheck.ok) {
    return {
      status: "denied",
      reason: recheck.reason,
      readyAt: recheck.readyAt,
    };
  }
  return {
    status: "denied",
    reason: "cooldown",
    readyAt: resetReadyAt(fresh.lastResetAt, pool.resetCooldownSec),
  };
}

export interface PoolStatusRow {
  pool: PoolConfig;
  stamina: number;
  max: number;
  nextAt: number | null;
  resetReadyAt: number;
  resetReady: boolean;
  owned: number;
  total: number;
}

export async function getStatusOverview(
  db: Db,
  userId: string,
  now: number,
): Promise<PoolStatusRow[]> {
  const poolRows = await db.select().from(pools).orderBy(pools.sortOrder);
  if (poolRows.length === 0) return [];
  const configs = poolRows.map(toPoolConfig);
  const results = await db.batch([
    db
      .select()
      .from(userPoolStates)
      .where(eq(userPoolStates.userId, userId)),
    ...configs.map((p) =>
      db
        .select({ n: sql<number>`count(distinct ${cards.memberId})` })
        .from(userCards)
        .innerJoin(cards, eq(userCards.cardId, cards.id))
        .where(
          and(
            eq(userCards.userId, userId),
            eq(cards.poolId, p.id),
            eq(cards.enabled, true),
          ),
        ),
    ),
  ]);
  const [stateRows, ...ownedCounts] = results;
  const byPool = new Map(
    (stateRows as typeof userPoolStates.$inferSelect[]).map((s) => [
      s.poolId,
      s,
    ]),
  );
  return poolRows.map((row, i) => {
    const pool = toPoolConfig(row);
    const s = byPool.get(pool.id);
    const normalized =
      s === undefined
        ? { stamina: pool.staminaMax, anchorAt: now }
        : normalize(
            { stamina: s.stamina, anchorAt: s.staminaAnchorAt },
            pool.staminaMax,
            pool.regenIntervalSec,
            now,
          );
    const lastReset = s?.lastResetAt ?? null;
    const readyAt = resetReadyAt(lastReset, pool.resetCooldownSec);
    const check = canReset(
      normalized,
      pool.staminaMax,
      lastReset,
      pool.resetCooldownSec,
      now,
    );
    return {
      pool,
      stamina: normalized.stamina,
      max: pool.staminaMax,
      nextAt: nextTickAt(normalized, pool.staminaMax, pool.regenIntervalSec),
      resetReadyAt: readyAt,
      resetReady: check.ok,
      owned: ownedCounts[i]?.[0]?.n ?? 0,
      total: row.memberCount,
    };
  });
}
