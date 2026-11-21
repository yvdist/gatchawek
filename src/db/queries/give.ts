import { and, eq, sql } from "drizzle-orm";
import { cards, gives, groups, members, pools, userCards } from "../schema.js";
import { CARD_POOL_NOT_HIDDEN_SQL } from "./poolVisibility.js";
import {
  giveExpiry,
  validateNewGive,
  type GiveMode,
  type GiveValidationError,
} from "../../domain/give.js";
import { RARITY_STARS, type RarityKey } from "../../domain/rarity.js";
import { nativeBatch, type Db } from "../client.js";

/** Holo and secret rarity cards are never giftable (user decision). */
const GIVEABLE_RARITY_SQL = sql.raw(`rarity NOT IN ('holo', 'secret')`);

export interface GiveCardChoice {
  id: string;
  label: string;
}

export interface GiveCardView {
  cardId: string;
  memberName: string;
  photoLabel: string | null;
  groupName: string;
  groupBadge: string;
  poolName: string;
  poolEmoji: string;
  photoNo: number;
  photoTotal: number;
  serial: number;
  rarity: RarityKey;
  imageFile: string;
}

export type GiveRow = typeof gives.$inferSelect;

export type GiveCreateOutcome =
  | { status: "ok"; giveId: string }
  | { status: "rejected"; reason: GiveValidationError };

export type ClaimGiveOutcome =
  | { status: "claimed" }
  | { status: "expired" }
  | { status: "not-found" }
  | { status: "not-open" }
  | { status: "owner-lost" };

/** Owned-card picker for gifting: normal copies, never holo/secret rarity. */
export async function searchGiftableCards(
  db: Db,
  ownerId: string,
  prefix: string,
): Promise<GiveCardChoice[]> {
  const sanitized = prefix.replace(/[%_\\]/g, "").toLowerCase();
  const likeCondition =
    sanitized === ""
      ? sql`1 = 1`
      : sql`${members.nameLower} LIKE ${`${sanitized}%`}`;
  const results = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${groups.badge} AS group_badge, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} WHERE ${userCards.userId} = ${ownerId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${CARD_POOL_NOT_HIDDEN_SQL} AND ${GIVEABLE_RARITY_SQL} AND ${likeCondition} ORDER BY ${members.nameLower}, ${cards.photoNo} LIMIT 25`,
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

interface GiveReadState {
  quantity: number;
  enabled: boolean;
  rarity: RarityKey | null;
}

async function readGiveState(
  db: Db,
  cardId: string,
  giverId: string,
): Promise<GiveReadState> {
  const [cardRows, ownedRows] = await db.batch([
    db
      .select({ enabled: cards.enabled, rarity: cards.rarity })
      .from(cards)
      .where(and(eq(cards.id, cardId), CARD_POOL_NOT_HIDDEN_SQL))
      .limit(1),
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(eq(userCards.userId, giverId), eq(userCards.cardId, cardId)),
      )
      .limit(1),
  ]);
  const card = cardRows[0];
  return {
    quantity: ownedRows[0]?.quantity ?? 0,
    enabled: card?.enabled === true,
    rarity: (card?.rarity ?? null) as RarityKey | null,
  };
}

export async function createGive(
  db: Db,
  args: {
    mode: GiveMode;
    giverId: string;
    targetId: string | null;
    targetIsBot: boolean;
    cardId: string;
    now: number;
  },
): Promise<GiveCreateOutcome> {
  const { mode, giverId, targetId, targetIsBot, cardId, now } = args;
  const [cardRows, ownedRows] = await db.batch([
    db
      .select({ enabled: cards.enabled, rarity: cards.rarity })
      .from(cards)
      .where(and(eq(cards.id, cardId), CARD_POOL_NOT_HIDDEN_SQL))
      .limit(1),
    db
      .select({ quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(eq(userCards.userId, giverId), eq(userCards.cardId, cardId)),
      )
      .limit(1),
  ]);
  const card = cardRows[0];
  const error = validateNewGive({
    giverId,
    targetId,
    targetIsBot,
    ownsCard: (ownedRows[0]?.quantity ?? 0) >= 1,
    cardEnabled: card?.enabled === true,
    rarity: (card?.rarity ?? null) as RarityKey | null,
  });
  if (error !== null) return { status: "rejected", reason: error };

  const giveId = crypto.randomUUID();
  const expiresAt = giveExpiry(now);
  // Atomic guard: the INSERT only fires while ownership and the rarity
  // guard still hold INSIDE the write batch.
  const targetInsert =
    targetId === null
      ? []
      : [
          sql`INSERT INTO users (id, created_at) VALUES (${targetId}, ${now}) ON CONFLICT (id) DO NOTHING`,
        ];
  const writeResults = await nativeBatch(db, [
    sql`INSERT INTO users (id, created_at) VALUES (${giverId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    ...targetInsert,
    sql`INSERT INTO gives (id, mode, giver_id, target_id, card_id, status, claimer_id, settle_token, created_at, expires_at, resolved_at)
SELECT ${giveId}, ${mode}, ${giverId}, ${targetId}, ${cardId}, 'open', NULL, NULL, ${now}, ${expiresAt}, NULL
WHERE EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${giverId} AND card_id = ${cardId} AND quantity >= 1)
AND EXISTS (SELECT 1 FROM cards WHERE id = ${cardId} AND enabled = 1 AND rarity NOT IN ('holo', 'secret') AND NOT EXISTS (SELECT 1 FROM ${pools} WHERE ${pools.id} = ${cards.poolId} AND ${pools.hidden} = 1))`,
  ]);
  const guarded = writeResults[writeResults.length - 1];
  if ((guarded?.meta.changes ?? 0) !== 1) {
    // Lost a race between the read batch and this write: re-read for the
    // true reason instead of guessing.
    const state = await readGiveState(db, cardId, giverId);
    const retryError = validateNewGive({
      giverId,
      targetId,
      targetIsBot,
      ownsCard: state.quantity >= 1,
      cardEnabled: state.enabled,
      rarity: state.rarity,
    });
    return { status: "rejected", reason: retryError ?? "card-not-owned" };
  }
  return { status: "ok", giveId };
}

export async function getGiveById(db: Db, id: string): Promise<GiveRow | null> {
  const rows = await db.select().from(gives).where(eq(gives.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Display view for one card. No `enabled` filter: the final giveaway
 * message must still render when the card was taken down mid-flight.
 */
export async function getGiveCardView(
  db: Db,
  cardId: string,
): Promise<GiveCardView | null> {
  const rows = await db
    .select({
      cardId: cards.id,
      memberName: members.name,
      photoLabel: cards.photoLabel,
      groupName: groups.name,
      groupBadge: groups.badge,
      poolName: pools.name,
      poolEmoji: pools.emoji,
      photoNo: cards.photoNo,
      photoTotal: members.photoTotal,
      serial: cards.serial,
      rarity: cards.rarity,
      imageFile: cards.imageFile,
    })
    .from(cards)
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .innerJoin(pools, eq(cards.poolId, pools.id))
    .where(eq(cards.id, cardId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return { ...row, rarity: row.rarity as RarityKey };
}

/**
 * Moves one normal copy from the giver to `claimerId`. Fastest click wins:
 * the guarded writes re-check `status = 'open'`, the expiry, the clicker
 * role and the giver's stock, then settle via `settleToken`.
 */
export async function claimGive(
  db: Db,
  giveId: string,
  claimerId: string,
  now: number,
): Promise<ClaimGiveOutcome> {
  const existing = await getGiveById(db, giveId);
  if (existing === null) return { status: "not-found" };
  if (existing.status !== "open") return { status: "not-open" };
  if (existing.expiresAt <= now) {
    const results = await nativeBatch(db, [
      sql`UPDATE gives SET status = 'expired', resolved_at = ${now} WHERE id = ${giveId} AND status = 'open'`,
    ]);
    return (results[0]?.meta.changes ?? 0) === 1
      ? { status: "expired" }
      : { status: "not-open" };
  }
  const giver = existing.giverId;
  const cardId = existing.cardId;

  const tok = crypto.randomUUID();
  const guard = sql`(SELECT 1 FROM gives WHERE id = ${giveId} AND settle_token = ${tok})`;
  await nativeBatch(db, [
    sql`INSERT INTO users (id, created_at) VALUES (${claimerId}, ${now}) ON CONFLICT (id) DO NOTHING`,
    sql`UPDATE gives SET status = 'claimed', claimer_id = ${claimerId}, resolved_at = ${now}, settle_token = ${tok} WHERE id = ${giveId} AND status = 'open' AND expires_at > ${now} AND giver_id <> ${claimerId} AND (mode = 'public' OR target_id = ${claimerId}) AND EXISTS (SELECT 1 FROM user_cards WHERE user_id = ${giver} AND card_id = ${cardId} AND quantity >= 1) AND NOT EXISTS (SELECT 1 FROM ${cards} JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${cards.id} = ${cardId} AND ${pools.hidden} = 1)`,
    sql`UPDATE user_cards SET quantity = quantity - 1 WHERE user_id = ${giver} AND card_id = ${cardId} AND EXISTS ${guard}`,
    sql`DELETE FROM user_cards WHERE quantity = 0 AND holo_qty = 0 AND user_id = ${giver} AND card_id = ${cardId} AND EXISTS ${guard}`,
    sql`INSERT INTO user_cards (user_id, card_id, quantity, holo_qty, first_obtained_at, last_obtained_at) SELECT ${claimerId}, ${cardId}, 1, 0, ${now}, ${now} WHERE EXISTS ${guard} ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + 1, last_obtained_at = excluded.last_obtained_at`,
  ]);

  const settled = await getGiveById(db, giveId);
  if (settled?.settleToken === tok) return { status: "claimed" };
  const current = settled ?? existing;
  if (current.status !== "open") return { status: "not-open" };
  await nativeBatch(db, [
    sql`UPDATE gives SET status = 'failed', resolved_at = ${now} WHERE id = ${giveId} AND status = 'open'`,
  ]);
  if (current.expiresAt <= now) return { status: "expired" };
  return { status: "owner-lost" };
}

export async function resolveGive(
  db: Db,
  giveId: string,
  status: "rejected" | "cancelled" | "expired",
  now: number,
): Promise<boolean> {
  const results = await nativeBatch(db, [
    sql`UPDATE gives SET status = ${status}, resolved_at = ${now} WHERE id = ${giveId} AND status = 'open'`,
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}
