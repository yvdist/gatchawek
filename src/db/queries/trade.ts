import { and, eq, inArray, sql } from "drizzle-orm";
import { cards, groups, members, pools, trades, userCards } from "../schema.js";
import {
  tradeExpiry,
  validateNewTrade,
  type TradeValidationError,
} from "../../domain/trade.js";
import { RARITY_STARS, type RarityKey } from "../../domain/rarity.js";
import { nativeBatch, type Db } from "../client.js";
import { CARD_POOL_NOT_HIDDEN_SQL } from "./poolVisibility.js";

export interface TradeCardView {
  cardId: string;
  memberName: string;
  photoLabel: string | null;
  groupBadge: string;
  photoNo: number;
  rarity: RarityKey;
}

export type CreateTradeOutcome =
  | { status: "ok"; tradeId: string }
  | { status: "rejected"; reason: TradeValidationError };

export type AcceptOutcome =
  | { status: "accepted" }
  | { status: "not-found" }
  | { status: "already-resolved" }
  | { status: "expired" }
  | { status: "ownership-changed" };

export type TradeRow = typeof trades.$inferSelect;

export async function createTrade(
  db: Db,
  args: {
    proposerId: string;
    targetId: string;
    targetIsBot: boolean;
    offerCardId: string;
    requestCardId: string;
    now: number;
  },
): Promise<CreateTradeOutcome> {
  const { proposerId, targetId, targetIsBot, offerCardId, requestCardId, now } =
    args;
  const [pendingRows, offerRows, requestRows, cardRows] = await db.batch([
    db
      .select({ n: sql<number>`count(*)` })
      .from(trades)
      .where(
        and(
          eq(trades.proposerId, proposerId),
          eq(trades.status, "pending"),
          sql`${trades.expiresAt} > ${now}`,
        ),
      ),
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(eq(userCards.userId, proposerId), eq(userCards.cardId, offerCardId)),
      )
      .limit(1),
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(eq(userCards.userId, targetId), eq(userCards.cardId, requestCardId)),
      )
      .limit(1),
    db
      .select({ id: cards.id, enabled: cards.enabled })
      .from(cards)
      .where(
        and(
          inArray(cards.id, [offerCardId, requestCardId]),
          CARD_POOL_NOT_HIDDEN_SQL,
        ),
      ),
  ]);
  const proposerPending = pendingRows[0]?.n ?? 0;
  const proposerOwnsOffer = (offerRows[0]?.quantity ?? 0) >= 1;
  const targetOwnsRequest = (requestRows[0]?.quantity ?? 0) >= 1;
  const offerEnabled =
    cardRows.find((r) => r.id === offerCardId)?.enabled === true;
  const requestEnabled =
    cardRows.find((r) => r.id === requestCardId)?.enabled === true;

  const error = validateNewTrade({
    proposerId,
    targetId,
    targetIsBot,
    offerCardId,
    requestCardId,
    proposerPending,
    proposerOwnsOffer,
    targetOwnsRequest,
    offerEnabled,
    requestEnabled,
  });
  if (error !== null) return { status: "rejected", reason: error };

  const tradeId = crypto.randomUUID();
  const expiresAt = tradeExpiry(now);
  // Atomic guard: the INSERT only fires when the quota and preconditions
  // still hold INSIDE the write batch. A parallel double-submit reads a
  // stale count in the read batch above, but only one INSERT can win.
  const writeResults = await nativeBatch(db, [
    sql`INSERT INTO users (id, created_at) VALUES (${proposerId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`INSERT INTO users (id, created_at) VALUES (${targetId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`INSERT INTO trades (id, proposer_id, target_id, offer_card_id, request_card_id, status, settle_token, channel_id, message_id, created_at, expires_at, resolved_at)
SELECT ${tradeId}, ${proposerId}, ${targetId}, ${offerCardId}, ${requestCardId}, 'pending', NULL, NULL, NULL, ${now}, ${expiresAt}, NULL
WHERE (SELECT COUNT(*) FROM trades WHERE proposer_id = ${proposerId} AND status = 'pending' AND expires_at > ${now}) < 3
AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${proposerId} AND card_id = ${offerCardId} AND quantity >= 1)
AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${targetId} AND card_id = ${requestCardId} AND quantity >= 1)
AND EXISTS (SELECT 1 FROM cards WHERE id = ${offerCardId} AND enabled = 1 AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1))
AND EXISTS (SELECT 1 FROM cards WHERE id = ${requestCardId} AND enabled = 1 AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1))`,
  ]);
  const guarded = writeResults[2];
  if ((guarded?.meta.changes ?? 0) !== 1) {
    // Lost a race (or state changed between the read batch and this
    // atomic write). Re-read to report the true reason, not a guess.
    const [pendingRows, offerRows, requestRows, cardRows] = await db.batch([
      db
        .select({ n: sql<number>`count(*)` })
        .from(trades)
        .where(
          and(
            eq(trades.proposerId, proposerId),
            eq(trades.status, "pending"),
            sql`${trades.expiresAt} > ${now}`,
          ),
        ),
      db
        .select({ quantity: userCards.quantity })
        .from(userCards)
        .where(
          and(eq(userCards.userId, proposerId), eq(userCards.cardId, offerCardId)),
        )
        .limit(1),
      db
        .select({ quantity: userCards.quantity })
        .from(userCards)
        .where(
          and(eq(userCards.userId, targetId), eq(userCards.cardId, requestCardId)),
        )
        .limit(1),
      db
        .select({ id: cards.id, enabled: cards.enabled })
        .from(cards)
        .where(
          and(
            inArray(cards.id, [offerCardId, requestCardId]),
            CARD_POOL_NOT_HIDDEN_SQL,
          ),
        ),
    ]);
    const retryError = validateNewTrade({
      proposerId,
      targetId,
      targetIsBot,
      offerCardId,
      requestCardId,
      proposerPending: pendingRows[0]?.n ?? 0,
      proposerOwnsOffer: (offerRows[0]?.quantity ?? 0) >= 1,
      targetOwnsRequest: (requestRows[0]?.quantity ?? 0) >= 1,
      offerEnabled:
        cardRows.find((r) => r.id === offerCardId)?.enabled === true,
      requestEnabled:
        cardRows.find((r) => r.id === requestCardId)?.enabled === true,
    });
    return { status: "rejected", reason: retryError ?? "pending-limit" };
  }
  return { status: "ok", tradeId };
}

export async function getTradeById(
  db: Db,
  tradeId: string,
): Promise<TradeRow | null> {
  const rows = await db
    .select()
    .from(trades)
    .where(eq(trades.id, tradeId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTradeCardViews(
  db: Db,
  cardIds: readonly [string, string],
): Promise<Map<string, TradeCardView>> {
  const [offerId, requestId] = cardIds;
  const rows = await db
    .select({
      id: cards.id,
      memberName: members.name,
      photoLabel: cards.photoLabel,
      groupBadge: groups.badge,
      photoNo: cards.photoNo,
      rarity: cards.rarity,
    })
    .from(cards)
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .where(inArray(cards.id, [offerId, requestId]));
  const views = new Map<string, TradeCardView>();
  for (const row of rows) {
    views.set(row.id, {
      cardId: row.id,
      memberName: row.memberName,
      photoLabel: row.photoLabel,
      groupBadge: row.groupBadge,
      photoNo: row.photoNo,
      rarity: row.rarity as RarityKey,
    });
  }
  return views;
}

export async function acceptTrade(
  db: Db,
  tradeId: string,
  now: number,
): Promise<AcceptOutcome> {
  const existing = await getTradeById(db, tradeId);
  if (existing === null) return { status: "not-found" };
  if (existing.status !== "pending") return { status: "already-resolved" };
  const { proposerId: proposer, targetId: target } = existing;
  const offer = existing.offerCardId;
  const request = existing.requestCardId;

  const tok = crypto.randomUUID();
  const guard = sql`(SELECT 1 FROM trades WHERE id = ${tradeId} AND settle_token = ${tok})`;
  await nativeBatch(db, [
    sql`UPDATE trades SET status = 'accepted', resolved_at = ${now}, settle_token = ${tok} WHERE id = ${tradeId} AND status = 'pending' AND expires_at > ${now} AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${proposer} AND card_id = ${offer} AND quantity >= 1) AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${target} AND card_id = ${request} AND quantity >= 1) AND NOT EXISTS (SELECT 1 FROM ${cards} JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${cards.id} IN (${offer}, ${request}) AND ${pools.hidden} = 1)`,
    sql`UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ${proposer} AND card_id = ${offer} AND EXISTS ${guard}`,
    sql`UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ${target} AND card_id = ${request} AND EXISTS ${guard}`,
    sql`DELETE FROM user_cards WHERE quantity = 0 AND ((user_id = ${proposer} AND card_id = ${offer}) OR (user_id = ${target} AND card_id = ${request})) AND EXISTS ${guard}`,
    sql`INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) SELECT ${target}, ${offer}, 1, ${now}, ${now} WHERE EXISTS ${guard} ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + 1, last_obtained_at = excluded.last_obtained_at`,
    sql`INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) SELECT ${proposer}, ${request}, 1, ${now}, ${now} WHERE EXISTS ${guard} ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + 1, last_obtained_at = excluded.last_obtained_at`,
  ]);

  const settled = await getTradeById(db, tradeId);
  if (settled?.settleToken === tok) return { status: "accepted" };
  const current = settled ?? existing;
  if (current.status !== "pending") return { status: "already-resolved" };
  await nativeBatch(db, [
    sql`UPDATE trades SET status = 'failed', resolved_at = ${now} WHERE id = ${tradeId} AND status = 'pending'`,
  ]);
  if (current.expiresAt <= now) return { status: "expired" };
  return { status: "ownership-changed" };
}

export async function resolveTrade(
  db: Db,
  tradeId: string,
  status: "declined" | "cancelled",
  now: number,
): Promise<boolean> {
  const results = await nativeBatch(db, [
    sql`UPDATE trades SET status = ${status}, resolved_at = ${now} WHERE id = ${tradeId} AND status = 'pending'`,
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}

export interface TradableCardChoice {
  id: string;
  label: string;
}

export async function searchTradableCards(
  db: Db,
  ownerId: string,
  prefix: string,
): Promise<TradableCardChoice[]> {
  const sanitized = prefix.replace(/[%_\\]/g, "").toLowerCase();
  const likeCondition =
    sanitized === ""
      ? sql`1 = 1`
      : sql`${members.nameLower} LIKE ${`${sanitized}%`}`;
  const results = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${groups.badge} AS group_badge, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} WHERE ${userCards.userId} = ${ownerId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${CARD_POOL_NOT_HIDDEN_SQL} AND ${likeCondition} ORDER BY ${members.nameLower}, ${cards.photoNo} LIMIT 25`,
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
        `${row.member_name} (${row.group_badge}) · Foto ${row.photo_no} · ${stars}`.slice(
          0,
          100,
        ),
    };
  });
}
