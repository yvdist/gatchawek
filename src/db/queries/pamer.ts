import { sql } from "drizzle-orm";
import { cards, groups, members, pools, userCards } from "../schema.js";
import { RARITY_STARS, type RarityKey } from "../../domain/rarity.js";
import { nativeBatch, type Db } from "../client.js";

export interface PamerCardChoice {
  id: string;
  label: string;
}

/** Owned-card picker, rarity-highest first. No data mutation. */
export async function searchShowcaseCards(
  db: Db,
  ownerId: string,
  prefix: string,
): Promise<PamerCardChoice[]> {
  const sanitized = prefix.replace(/[%_\\]/g, "").toLowerCase();
  const likeCondition =
    sanitized === ""
      ? sql`1 = 1`
      : sql`${members.nameLower} LIKE ${`${sanitized}%`}`;
  // No userCards.quantity in SELECT: filter-only. Rarity rank via CASE keeps
  // ordering in SQL so no comparator is needed in domain/UI layers.
  const results = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${groups.badge} AS group_badge, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} WHERE ${userCards.userId} = ${ownerId} AND ${userCards.quantity} >= 1 AND ${cards.enabled} = 1 AND ${likeCondition} ORDER BY CASE ${cards.rarity} WHEN 'ultra_rare' THEN 0 WHEN 'super_rare' THEN 1 WHEN 'rare' THEN 2 ELSE 3 END, ${members.nameLower}, ${cards.photoNo} LIMIT 25`,
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

export interface ShowcaseCard {
  id: string;
  memberName: string;
  photoLabel: string | null;
  fullName: string | null;
  photoNo: number;
  photoTotal: number;
  serial: number;
  rarity: RarityKey;
  imageFile: string;
  groupName: string;
  groupBadge: string;
  poolName: string;
  poolEmoji: string;
  quantity: number;
}

/**
 * Full display view for one owned, enabled card.
 * Null when not owned by `ownerId`, taken down, or id is unknown.
 * Read-only: single SELECT, no batch/mutation.
 */
export async function getShowcaseCard(
  db: Db,
  ownerId: string,
  cardId: string,
): Promise<ShowcaseCard | null> {
  const results = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${cards.photoLabel} AS photo_label, ${members.fullName} AS full_name, ${cards.photoNo} AS photo_no, ${members.photoTotal} AS photo_total, ${cards.serial} AS serial, ${cards.rarity} AS rarity, ${cards.imageFile} AS image_file, ${groups.name} AS group_name, ${groups.badge} AS group_badge, ${pools.name} AS pool_name, ${pools.emoji} AS pool_emoji, ${userCards.quantity} AS quantity FROM ${cards} INNER JOIN ${members} ON ${members.id} = ${cards.memberId} INNER JOIN ${groups} ON ${groups.id} = ${cards.groupId} INNER JOIN ${pools} ON ${pools.id} = ${cards.poolId} INNER JOIN ${userCards} ON ${userCards.cardId} = ${cards.id} AND ${userCards.userId} = ${ownerId} AND ${userCards.quantity} >= 1 WHERE ${cards.id} = ${cardId} AND ${cards.enabled} = 1 LIMIT 1`,
  ]);
  const row = (results[0]?.results ?? [])[0] as unknown as
    | {
        id: string;
        member_name: string;
        photo_label: string | null;
        full_name: string | null;
        photo_no: number;
        photo_total: number;
        serial: number;
        rarity: RarityKey;
        image_file: string;
        group_name: string;
        group_badge: string;
        pool_name: string;
        pool_emoji: string;
        quantity: number;
      }
    | undefined;
  if (row === undefined) return null;
  return {
    id: row.id,
    memberName: row.member_name,
    photoLabel: row.photo_label,
    fullName: row.full_name,
    photoNo: row.photo_no,
    photoTotal: row.photo_total,
    serial: row.serial,
    rarity: row.rarity,
    imageFile: row.image_file,
    groupName: row.group_name,
    groupBadge: row.group_badge,
    poolName: row.pool_name,
    poolEmoji: row.pool_emoji,
    quantity: row.quantity,
  };
}
