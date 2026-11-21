import { and, eq, like, sql } from "drizzle-orm";
import { cards, groups, members } from "../schema.js";
import type { Db } from "../client.js";
import type { RarityKey } from "../../domain/rarity.js";

export interface CariOwner {
  userId: string;
  qty: number;
  holoQty: number;
}

 export interface CariCard {
   cardId: string;
   photoNo: number;
   photoTotal: number;
   serial: number;
   imageFile: string;
   photoLabel: string | null;
   rarity: RarityKey;
   owners: CariOwner[];
 }

export interface CariMember {
  memberId: string;
  memberName: string;
  groupName: string;
  poolId: string;
  cards: CariCard[];
}

/** Holo and secret rarity cards never surface in /cari (user decision). */
export const VISIBLE_RARITY_SQL = sql.raw(`rarity NOT IN ('holo', 'secret')`);

export const MEMBER_HAS_VISIBLE_CARD_SQL = sql`EXISTS (SELECT 1 FROM cards WHERE cards.member_id = members.id AND cards.enabled = 1 AND rarity NOT IN ('holo', 'secret'))`;

export const CARI_MEMBER_LIMIT = 8;
export const CARI_CARD_LIMIT = 25;
export const CARI_OWNER_LIMIT = 10;

export function sanitizeCariPrefix(raw: string): string {
  return raw.replace(/[%_\\]/g, "").toLowerCase();
}

 export async function searchMembers(
   db: Db,
   prefix: string,
   poolId: string | null,
 ): Promise<CariMember[]> {
   const sanitized = sanitizeCariPrefix(prefix);
   const nameWhere =
     sanitized === "" ? sql`1 = 1` : like(members.nameLower, `%${sanitized}%`);
   const nameRows = await db
     .select({
       id: members.id,
       name: members.name,
       groupName: groups.name,
       poolId: members.poolId,
       photoTotal: members.photoTotal,
     })
     .from(members)
     .innerJoin(groups, eq(members.groupId, groups.id))
     .where(
       and(
         eq(members.enabled, true),
         poolId === null ? sql`1 = 1` : eq(members.poolId, poolId),
         nameWhere,
         MEMBER_HAS_VISIBLE_CARD_SQL,
       ),
     )
     .orderBy(members.nameLower)
     .limit(CARI_MEMBER_LIMIT);
   // Label arm: match per-photo names (e.g. "ryan") that never appear in
   // members.nameLower (= "jomok mix NN"). Empty query matches all labels.
   const labelWhere =
     sanitized === ""
       ? and(eq(cards.enabled, true), VISIBLE_RARITY_SQL)
       : and(
           eq(cards.enabled, true),
           VISIBLE_RARITY_SQL,
           like(sql`lower(${cards.photoLabel})`, `%${sanitized}%`),
         );
   const labelRows =
     nameRows.length >= CARI_MEMBER_LIMIT
       ? []
       : await db
           .selectDistinct({ memberId: cards.memberId })
           .from(cards)
           .where(
             and(
               poolId === null ? sql`1 = 1` : eq(cards.poolId, poolId),
               labelWhere,
             ),
           )
           .limit(CARI_MEMBER_LIMIT);
   const memberRows = [...nameRows];
   if (labelRows.length > 0) {
     const nameIds = new Set(nameRows.map((m) => m.id));
     const extraIds = labelRows
       .map((r) => r.memberId)
       .filter((id) => !nameIds.has(id));
     if (extraIds.length > 0) {
       const extraRows = await db
         .select({
           id: members.id,
           name: members.name,
           groupName: groups.name,
           poolId: members.poolId,
           photoTotal: members.photoTotal,
         })
         .from(members)
         .innerJoin(groups, eq(members.groupId, groups.id))
         .where(
           and(
             eq(members.enabled, true),
             sql`${members.id} IN (${sql.join(extraIds.map((id) => sql`${id}`), sql`, `)})`,
           ),
         )
         .orderBy(members.nameLower)
         .limit(CARI_MEMBER_LIMIT - memberRows.length);
       memberRows.push(...extraRows);
     }
   }
   if (memberRows.length === 0) return [];
   const cardRows = await db
     .select({
       id: cards.id,
       memberId: cards.memberId,
       photoNo: cards.photoNo,
       serial: cards.serial,
       imageFile: cards.imageFile,
       photoLabel: cards.photoLabel,
       rarity: cards.rarity,
     })
     .from(cards)
     .where(
       and(
         sql`${cards.memberId} IN (${sql.join(memberRows.map((m) => sql`${m.id}`), sql`, `)})`,
         eq(cards.enabled, true),
         VISIBLE_RARITY_SQL,
       ),
     )
     .orderBy(cards.photoNo)
     .limit(memberRows.length * CARI_CARD_LIMIT);
  // Label-only members: show ONLY label-matching cards (strict per-photo
  // result). Name-matched members keep all their cards. Cap preserved.
  const nameHitIds = new Set(nameRows.map((m) => m.id));
  const photoTotalByMember = new Map(memberRows.map((m) => [m.id, m.photoTotal] as const));
  const byMember = new Map<string, CariCard[]>();
  for (const c of cardRows) {
    if (
      sanitized !== "" &&
      !nameHitIds.has(c.memberId) &&
      (c.photoLabel === null || !c.photoLabel.toLowerCase().includes(sanitized))
    ) {
      continue;
    }
    const list = byMember.get(c.memberId) ?? [];
    if (list.length < CARI_CARD_LIMIT) {
      list.push({ cardId: c.id, photoNo: c.photoNo, photoTotal: photoTotalByMember.get(c.memberId) ?? 0, serial: c.serial, imageFile: c.imageFile, photoLabel: c.photoLabel, rarity: c.rarity, owners: [] });
      byMember.set(c.memberId, list);
    }
  }
  const flat = [...byMember.values()].flat();
  if (flat.length > 0) {
    const perCardRemaining = new Map<string, number>(flat.map((c) => [c.cardId, CARI_OWNER_LIMIT]));
    // Cap owners per card via row_number window: one query, no N+1.
    const ownerRows = await db
      .select({
        cardId: sql<string>`card_id`,
        userId: sql<string>`user_id`,
        qty: sql<number>`quantity`,
        holoQty: sql<number>`holo_qty`,
      })
      .from(
        sql`(SELECT card_id, user_id, quantity, holo_qty,
          ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY quantity DESC, holo_qty DESC, user_id) AS rn
          FROM user_cards WHERE card_id IN (${sql.join(flat.map((c) => sql`${c.cardId}`), sql`, `)}))`,
      )
      .where(sql`rn <= 10`)
      .limit(flat.length * CARI_OWNER_LIMIT);
    const byCard = new Map(flat.map((c) => [c.cardId, c] as const));
    for (const o of ownerRows) {
      const card = byCard.get(o.cardId);
      const remaining = perCardRemaining.get(o.cardId) ?? 0;
      if (card === undefined || remaining <= 0) continue;
      card.owners.push({ userId: o.userId, qty: o.qty, holoQty: o.holoQty });
      perCardRemaining.set(o.cardId, remaining - 1);
    }
  }
  return memberRows.map((m) => ({
    memberId: m.id,
    memberName: m.name,
    groupName: m.groupName,
    poolId: m.poolId,
    cards: byMember.get(m.id) ?? [],
  }));
}
