import { and, asc, eq, ne, sql } from "drizzle-orm";
import { cards, groups, members, pools, userPoolStates, wishes } from "../schema.js";
import { nativeBatch, type Db } from "../client.js";
import { cardDisplayName } from "../../domain/gacha.js";
import { MAX_WISHES_PER_POOL } from "../../domain/wish.js";
import type { RarityKey } from "../../domain/rarity.js";

export interface WishCard {
  cardId: string;
  poolId: string;
  poolName: string;
  poolEmoji: string;
  name: string;
  groupBadge: string;
  rarity: RarityKey;
}

const wishCardColumns = {
  cardId: cards.id,
  poolId: cards.poolId,
  poolName: pools.name,
  poolEmoji: pools.emoji,
  photoLabel: cards.photoLabel,
  memberName: members.name,
  groupBadge: groups.badge,
  rarity: cards.rarity,
};

type WishCardRow = Awaited<ReturnType<typeof wishableCards>>[number];

function toWishCard(r: WishCardRow): WishCard {
  return {
    cardId: r.cardId,
    poolId: r.poolId,
    poolName: r.poolName,
    poolEmoji: r.poolEmoji,
    name: cardDisplayName(r.photoLabel, r.memberName),
    groupBadge: r.groupBadge,
    rarity: r.rarity,
  };
}

function wishableCards(db: Db) {
  return db
    .select(wishCardColumns)
    .from(cards)
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .innerJoin(pools, eq(cards.poolId, pools.id));
}

const wishableWhere = and(
  eq(cards.enabled, true),
  eq(pools.enabled, true),
  ne(cards.rarity, "secret"),
);

/** Wishes that can still drop in this pool (enabled, non-Secret). */
export async function getActiveWishes(
  db: Db,
  userId: string,
  poolId: string,
): Promise<{ cardId: string; rarity: RarityKey }[]> {
  return db
    .select({ cardId: cards.id, rarity: cards.rarity })
    .from(wishes)
    .innerJoin(cards, eq(wishes.cardId, cards.id))
    .where(
      and(
        eq(wishes.userId, userId),
        eq(wishes.poolId, poolId),
        eq(cards.enabled, true),
        ne(cards.rarity, "secret"),
      ),
    )
    .orderBy(asc(wishes.createdAt), asc(cards.id));
}

/**
 * Resolves `/wish` input. Autocomplete sends a card id, but only for non-Holo
 * cards (Holo names stay hidden), so Holo must match its exact name.
 * Null when nothing matches; "ambiguous" when the name hits several cards.
 */
export async function findWishableCard(
  db: Db,
  input: string,
): Promise<WishCard | "ambiguous" | null> {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const byId = await wishableCards(db)
    .where(and(wishableWhere, eq(cards.id, trimmed), ne(cards.rarity, "holo")))
    .limit(1);
  if (byId[0] !== undefined) return toWishCard(byId[0]);
  const lower = trimmed.toLowerCase();
  const byName = await wishableCards(db)
    .where(
      and(
        wishableWhere,
        sql`lower(coalesce(${cards.photoLabel}, ${members.name})) = ${lower}`,
      ),
    )
    .limit(2);
  if (byName.length > 1) return "ambiguous";
  return byName[0] === undefined ? null : toWishCard(byName[0]);
}

/** Autocomplete: wishable cards below Holo; Holo names are never listed. */
export async function searchWishableCards(
  db: Db,
  typed: string,
): Promise<WishCard[]> {
  const sanitized = typed.replace(/[%_\\]/g, "").toLowerCase();
  const rows = await wishableCards(db)
    .where(
      and(
        wishableWhere,
        ne(cards.rarity, "holo"),
        sanitized === ""
          ? sql`1 = 1`
          : sql`lower(coalesce(${cards.photoLabel}, ${members.name})) LIKE ${`%${sanitized}%`}`,
      ),
    )
    .orderBy(asc(members.nameLower), asc(cards.photoNo))
    .limit(25);
  return rows.map(toWishCard);
}

export type AddWishOutcome = "ok" | "duplicate" | "full";

/** Atomic: the count guard and the insert run in one statement. */
export async function addWish(
  db: Db,
  userId: string,
  card: WishCard,
  now: number,
): Promise<AddWishOutcome> {
  const results = await nativeBatch(db, [
    sql`INSERT OR IGNORE INTO users (id, created_at) VALUES (${userId}, ${now})`,
    sql`INSERT INTO wishes (user_id, pool_id, card_id, created_at)
SELECT ${userId}, ${card.poolId}, ${card.cardId}, ${now}
WHERE (SELECT count(*) FROM wishes WHERE user_id = ${userId} AND pool_id = ${card.poolId}) < ${MAX_WISHES_PER_POOL}
ON CONFLICT (user_id, card_id) DO NOTHING`,
  ]);
  if ((results[1]?.meta.changes ?? 0) === 1) return "ok";
  const existing = await db
    .select({ one: sql<number>`1` })
    .from(wishes)
    .where(and(eq(wishes.userId, userId), eq(wishes.cardId, card.cardId)))
    .limit(1);
  return existing.length > 0 ? "duplicate" : "full";
}

/** True when a wish row was removed. Does not touch the pool's pity counter. */
export async function removeWish(
  db: Db,
  userId: string,
  cardId: string,
): Promise<boolean> {
  const [res] = await nativeBatch(db, [
    sql`DELETE FROM wishes WHERE user_id = ${userId} AND card_id = ${cardId}`,
  ]);
  return (res?.meta.changes ?? 0) === 1;
}

/** Card id among the user's own wishes, matched by id or exact name. */
export async function findOwnWish(
  db: Db,
  userId: string,
  input: string,
): Promise<WishCard | null> {
  const trimmed = input.trim();
  const own = await listWishes(db, userId);
  const lower = trimmed.toLowerCase();
  return (
    own.find((w) => w.cardId === trimmed) ??
    own.find((w) => w.name.toLowerCase() === lower) ??
    null
  );
}

interface WishlistPool {
  poolId: string;
  poolName: string;
  poolEmoji: string;
  pity: number;
  cards: WishCard[];
}

export async function listWishes(db: Db, userId: string): Promise<WishCard[]> {
  const rows = await db
    .select(wishCardColumns)
    .from(wishes)
    .innerJoin(cards, eq(wishes.cardId, cards.id))
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .innerJoin(pools, eq(cards.poolId, pools.id))
    .where(eq(wishes.userId, userId))
    .orderBy(asc(pools.sortOrder), asc(wishes.createdAt));
  return rows.map(toWishCard);
}

/** The user's wishes grouped per pool, with that pool's pity counter. */
export async function getWishlist(
  db: Db,
  userId: string,
): Promise<WishlistPool[]> {
  const [own, states] = await Promise.all([
    listWishes(db, userId),
    db
      .select({ poolId: userPoolStates.poolId, pity: userPoolStates.pityWish })
      .from(userPoolStates)
      .where(eq(userPoolStates.userId, userId)),
  ]);
  const pityByPool = new Map(states.map((s) => [s.poolId, s.pity]));
  const byPool = new Map<string, WishlistPool>();
  for (const w of own) {
    const entry = byPool.get(w.poolId) ?? {
      poolId: w.poolId,
      poolName: w.poolName,
      poolEmoji: w.poolEmoji,
      pity: pityByPool.get(w.poolId) ?? 0,
      cards: [],
    };
    entry.cards.push(w);
    byPool.set(w.poolId, entry);
  }
  return [...byPool.values()];
}
