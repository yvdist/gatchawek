import { and, eq, sql } from "drizzle-orm";
import {
  battles,
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../schema.js";
import {
  BATTLE_BASE_POWER,
  battleExpiry,
  duplicateBonus,
  resolveBattleCalculation,
  validateNewBattle,
  type BattleCalculationResult,
  type BattleMode,
  type BattleValidationError,
} from "../../domain/battle.js";
import { cardDisplayName } from "../../domain/gacha.js";
import {
  battleWinExp,
  deriveExpGainFromNewTotal,
  type ExpGainSummary,
} from "../../domain/level.js";
import { RARITY_STARS, type RarityKey } from "../../domain/rarity.js";
import { nativeBatch, type Db } from "../client.js";
import { CARD_POOL_NOT_HIDDEN_SQL } from "./poolVisibility.js";

export interface BattleCardView {
  cardId: string;
  memberName: string;
  photoLabel: string | null;
  groupBadge: string;
  photoNo: number;
  rarity: RarityKey;
  imageFile: string;
  quantity: number;
}

export interface TargetCardOption {
  id: string;
  label: string;
  description: string;
}

export type BattleRow = typeof battles.$inferSelect;

export type CreateBattleOutcome =
  | {
      status: "ok";
      battleId: string;
      challengerRarity: RarityKey;
      expiresAt: number;
    }
  | { status: "rejected"; reason: BattleValidationError };

export type SettleBattleOutcome =
  | {
      status: "resolved";
      calc: BattleCalculationResult;
      challengerCard: BattleCardView;
      targetCard: BattleCardView;
      mode: BattleMode;
      winnerStats: { wins: number; losses: number };
      winnerExp: ExpGainSummary;
    }
  | { status: "not-found" }
  | { status: "already-resolved" }
  | { status: "expired" }
  | { status: "ownership-changed" };

/** Top 25 active cards owned by the challenged player for the dropdown picker. */
export async function listTargetBattleCards(
  db: Db,
  targetId: string,
): Promise<TargetCardOption[]> {
  const results = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${cards.photoLabel} AS photo_label, ${groups.badge} AS group_badge, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity, ${userCards.quantity} AS quantity FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} WHERE ${userCards.userId} = ${targetId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${CARD_POOL_NOT_HIDDEN_SQL} ORDER BY CASE ${cards.rarity} WHEN 'secret' THEN 0 WHEN 'holo' THEN 1 WHEN 'ultra_rare' THEN 2 WHEN 'super_rare' THEN 3 WHEN 'rare' THEN 4 ELSE 5 END, ${userCards.quantity} DESC, ${members.nameLower}, ${cards.photoNo} LIMIT 25`,
  ]);
  const rows = (results[0]?.results ?? []) as unknown as {
    id: string;
    member_name: string;
    photo_label: string | null;
    group_badge: string;
    photo_no: number;
    rarity: RarityKey;
    quantity: number;
  }[];
  return rows.map((row) => {
    const displayName = cardDisplayName(row.photo_label, row.member_name);
    const stars = RARITY_STARS[row.rarity];
    return {
      id: row.id,
      label: `${stars} ${displayName} (${row.group_badge})`.slice(0, 100),
      description:
        `Foto #${row.photo_no} · Punya ×${row.quantity} · Base ${BATTLE_BASE_POWER[row.rarity]} (+${duplicateBonus(row.quantity)} dup)`.slice(
          0,
          100,
        ),
    };
  });
}

async function readCreatePreconditions(
  db: Db,
  challengerId: string,
  targetId: string,
  challengerCardId: string,
  now: number,
) {
  const [pendingRows, ownRows, cardRows, targetCountRows] = await db.batch([
    db
      .select({ n: sql<number>`count(*)` })
      .from(battles)
      .where(
        and(
          eq(battles.challengerId, challengerId),
          eq(battles.status, "pending"),
          sql`${battles.expiresAt} > ${now}`,
        ),
      ),
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(
          eq(userCards.userId, challengerId),
          eq(userCards.cardId, challengerCardId),
        ),
      )
      .limit(1),
    db
      .select({
        id: cards.id,
        enabled: cards.enabled,
        rarity: cards.rarity,
      })
      .from(cards)
      .where(and(eq(cards.id, challengerCardId), CARD_POOL_NOT_HIDDEN_SQL))
      .limit(1),
    db
      .select({ n: sql<number>`count(*)` })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(
        and(
          eq(userCards.userId, targetId),
          sql`${userCards.quantity} >= 1`,
          eq(cards.enabled, true),
          CARD_POOL_NOT_HIDDEN_SQL,
        ),
      ),
  ]);
  return {
    challengerPending: pendingRows[0]?.n ?? 0,
    challengerOwnsCard: (ownRows[0]?.quantity ?? 0) >= 1,
    cardEnabled: cardRows[0]?.enabled === true,
    challengerRarity: (cardRows[0]?.rarity ?? null) as RarityKey | null,
    targetCardCount: targetCountRows[0]?.n ?? 0,
  };
}

export async function createBattle(
  db: Db,
  args: {
    challengerId: string;
    targetId: string;
    targetIsBot: boolean;
    challengerCardId: string;
    mode: BattleMode;
    now: number;
  },
): Promise<CreateBattleOutcome> {
  const { challengerId, targetId, targetIsBot, challengerCardId, mode, now } =
    args;
  const pre = await readCreatePreconditions(
    db,
    challengerId,
    targetId,
    challengerCardId,
    now,
  );
  const error = validateNewBattle({
    challengerId,
    targetId,
    targetIsBot,
    challengerPending: pre.challengerPending,
    challengerOwnsCard: pre.challengerOwnsCard,
    cardEnabled: pre.cardEnabled,
    targetCardCount: pre.targetCardCount,
  });
  if (error !== null || pre.challengerRarity === null) {
    return { status: "rejected", reason: error ?? "card-disabled" };
  }

  const battleId = crypto.randomUUID();
  const expiresAt = battleExpiry(now);
  const writeResults = await nativeBatch(db, [
    sql`INSERT INTO users (id, created_at) VALUES (${challengerId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`INSERT INTO users (id, created_at) VALUES (${targetId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`INSERT INTO battles (id, challenger_id, target_id, challenger_card_id, target_card_id, mode, status, winner_id, challenger_score, target_score, challenger_crit, target_crit, settle_token, created_at, expires_at, resolved_at)
SELECT ${battleId}, ${challengerId}, ${targetId}, ${challengerCardId}, NULL, ${mode}, 'pending', NULL, NULL, NULL, 0, 0, NULL, ${now}, ${expiresAt}, NULL
WHERE (SELECT COUNT(*) FROM battles WHERE challenger_id = ${challengerId} AND status = 'pending' AND expires_at > ${now}) < 3
AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${challengerId} AND card_id = ${challengerCardId} AND quantity >= 1)
AND EXISTS (SELECT 1 FROM cards WHERE id = ${challengerCardId} AND enabled = 1 AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1))
AND EXISTS (SELECT 1 FROM user_cards uc JOIN cards c ON c.id = uc.card_id WHERE uc.user_id = ${targetId} AND uc.quantity >= 1 AND c.enabled = 1 AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = c.pool_id AND ${pools.hidden} = 1))`,
  ]);
  const guarded = writeResults[2];
  if ((guarded?.meta.changes ?? 0) !== 1) {
    const retry = await readCreatePreconditions(
      db,
      challengerId,
      targetId,
      challengerCardId,
      now,
    );
    const retryError = validateNewBattle({
      challengerId,
      targetId,
      targetIsBot,
      challengerPending: retry.challengerPending,
      challengerOwnsCard: retry.challengerOwnsCard,
      cardEnabled: retry.cardEnabled,
      targetCardCount: retry.targetCardCount,
    });
    return { status: "rejected", reason: retryError ?? "pending-limit" };
  }
  return {
    status: "ok",
    battleId,
    challengerRarity: pre.challengerRarity,
    expiresAt,
  };
}

export async function getBattleById(
  db: Db,
  battleId: string,
): Promise<BattleRow | null> {
  const rows = await db
    .select()
    .from(battles)
    .where(eq(battles.id, battleId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBattleCardView(
  db: Db,
  ownerId: string,
  cardId: string,
): Promise<BattleCardView | null> {
  const rows = await db
    .select({
      cardId: cards.id,
      memberName: members.name,
      photoLabel: cards.photoLabel,
      groupBadge: groups.badge,
      photoNo: cards.photoNo,
      rarity: cards.rarity,
      imageFile: cards.imageFile,
      quantity: userCards.quantity,
    })
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .innerJoin(members, eq(members.id, cards.memberId))
    .innerJoin(groups, eq(groups.id, cards.groupId))
    .where(
      and(
        eq(userCards.userId, ownerId),
        eq(userCards.cardId, cardId),
        sql`${userCards.quantity} >= 1`,
        eq(cards.enabled, true),
        CARD_POOL_NOT_HIDDEN_SQL,
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    cardId: row.cardId,
    memberName: row.memberName,
    photoLabel: row.photoLabel,
    groupBadge: row.groupBadge,
    photoNo: row.photoNo,
    rarity: row.rarity as RarityKey,
    imageFile: row.imageFile,
    quantity: row.quantity,
  };
}

export async function getPlayerBattleStats(
  db: Db,
  userId: string,
): Promise<{ wins: number; losses: number }> {
  const results = await nativeBatch(db, [
    sql`SELECT IFNULL(SUM(CASE WHEN ${battles.winnerId} = ${userId} THEN 1 ELSE 0 END), 0) AS wins, IFNULL(SUM(CASE WHEN ${battles.winnerId} != ${userId} THEN 1 ELSE 0 END), 0) AS losses FROM ${battles} WHERE ${battles.status} = 'resolved' AND (${battles.challengerId} = ${userId} OR ${battles.targetId} = ${userId})`,
  ]);
  const row = (results[0]?.results?.[0] ?? undefined) as
    | { wins?: number; losses?: number }
    | undefined;
  return {
    wins: Number(row?.wins ?? 0),
    losses: Number(row?.losses ?? 0),
  };
}

export async function settleBattle(
  db: Db,
  args: {
    battleId: string;
    targetCardId: string;
    now: number;
    rand: () => number;
  },
): Promise<SettleBattleOutcome> {
  const existing = await getBattleById(db, args.battleId);
  if (existing === null) return { status: "not-found" };
  if (existing.status !== "pending") return { status: "already-resolved" };
  if (existing.expiresAt <= args.now) {
    await resolveBattleCancelOrDecline(db, args.battleId, "cancelled", args.now);
    return { status: "expired" };
  }

  const [challengerCard, targetCard] = await Promise.all([
    getBattleCardView(db, existing.challengerId, existing.challengerCardId),
    getBattleCardView(db, existing.targetId, args.targetCardId),
  ]);
  if (challengerCard === null || targetCard === null) {
    await nativeBatch(db, [
      sql`UPDATE battles SET status = 'failed', resolved_at = ${args.now} WHERE id = ${args.battleId} AND status = 'pending'`,
    ]);
    return { status: "ownership-changed" };
  }

  const calc = resolveBattleCalculation({
    challengerId: existing.challengerId,
    targetId: existing.targetId,
    challenger: {
      rarity: challengerCard.rarity,
      quantity: challengerCard.quantity,
    },
    target: {
      rarity: targetCard.rarity,
      quantity: targetCard.quantity,
    },
    rand: args.rand,
  });

  const mode = existing.mode as BattleMode;
  const wonCard =
    calc.winnerId === existing.challengerId ? targetCard : challengerCard;
  const expGain = battleWinExp(mode, wonCard.rarity);

  const tok = crypto.randomUUID();
  const guard = sql`(SELECT 1 FROM battles WHERE id = ${args.battleId} AND settle_token = ${tok})`;
  const stmts = [
    sql`UPDATE battles SET status = 'resolved', target_card_id = ${args.targetCardId}, winner_id = ${calc.winnerId}, challenger_score = ${calc.challengerRoll.total}, target_score = ${calc.targetRoll.total}, challenger_crit = ${calc.challengerRoll.isCrit ? 1 : 0}, target_crit = ${calc.targetRoll.isCrit ? 1 : 0}, resolved_at = ${args.now}, settle_token = ${tok} WHERE id = ${args.battleId} AND status = 'pending' AND expires_at > ${args.now} AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${existing.challengerId} AND card_id = ${existing.challengerCardId} AND quantity >= 1) AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${existing.targetId} AND card_id = ${args.targetCardId} AND quantity >= 1) AND EXISTS (SELECT 1 FROM cards WHERE id = ${existing.challengerCardId} AND enabled = 1 AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1)) AND EXISTS (SELECT 1 FROM cards WHERE id = ${args.targetCardId} AND enabled = 1 AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1))`,
  ];

  if (mode === "wager") {
    const loserId = calc.loserId;
    const loserCardId = wonCard.cardId;
    stmts.push(
      sql`UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ${loserId} AND card_id = ${loserCardId} AND EXISTS ${guard}`,
      sql`DELETE FROM user_cards WHERE quantity = 0 AND holo_qty = 0 AND user_id = ${loserId} AND card_id = ${loserCardId} AND EXISTS ${guard}`,
      sql`INSERT INTO user_cards (user_id, card_id, quantity, holo_qty, first_obtained_at, last_obtained_at) SELECT ${calc.winnerId}, ${loserCardId}, 1, 0, ${args.now}, ${args.now} WHERE EXISTS ${guard} ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + 1, last_obtained_at = excluded.last_obtained_at`,
      sql`UPDATE users SET exp = exp + ${expGain} WHERE id = ${calc.winnerId} AND EXISTS ${guard}`,
    );
  }

  await nativeBatch(db, stmts);
  const settled = await getBattleById(db, args.battleId);
  if (settled?.settleToken === tok) {
    const [statsResult, expResult] = await nativeBatch(db, [
      sql`SELECT IFNULL(SUM(CASE WHEN ${battles.winnerId} = ${calc.winnerId} THEN 1 ELSE 0 END), 0) AS wins, IFNULL(SUM(CASE WHEN ${battles.winnerId} != ${calc.winnerId} THEN 1 ELSE 0 END), 0) AS losses FROM ${battles} WHERE ${battles.status} = 'resolved' AND (${battles.challengerId} = ${calc.winnerId} OR ${battles.targetId} = ${calc.winnerId})`,
      sql`SELECT ${users.exp} AS exp FROM ${users} WHERE ${users.id} = ${calc.winnerId} LIMIT 1`,
    ]);
    const statsRow = (statsResult?.results?.[0] ?? undefined) as
      | { wins?: number; losses?: number }
      | undefined;
    const expRow = (expResult?.results?.[0] ?? undefined) as
      | { exp?: number }
      | undefined;
    const winnerTotalExp = Number(expRow?.exp ?? expGain);
    return {
      status: "resolved",
      calc,
      challengerCard,
      targetCard,
      mode,
      winnerStats: {
        wins: Number(statsRow?.wins ?? 0),
        losses: Number(statsRow?.losses ?? 0),
      },
      winnerExp: deriveExpGainFromNewTotal(winnerTotalExp, expGain),
    };
  }
  const current = settled ?? existing;
  if (current.status !== "pending") return { status: "already-resolved" };
  await nativeBatch(db, [
    sql`UPDATE battles SET status = 'failed', resolved_at = ${args.now} WHERE id = ${args.battleId} AND status = 'pending'`,
  ]);
  if (current.expiresAt <= args.now) return { status: "expired" };
  return { status: "ownership-changed" };
}

export async function resolveBattleCancelOrDecline(
  db: Db,
  battleId: string,
  status: "declined" | "cancelled",
  now: number,
): Promise<boolean> {
  const results = await nativeBatch(db, [
    sql`UPDATE battles SET status = ${status}, resolved_at = ${now} WHERE id = ${battleId} AND status = 'pending'`,
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}
