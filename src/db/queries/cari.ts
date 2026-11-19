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
  const memberRows = await db
    .select({
      id: members.id,
      name: members.name,
      groupName: groups.name,
      poolId: members.poolId,
    })
    .from(members)
    .innerJoin(groups, eq(members.groupId, groups.id))
    .where(
      and(
        eq(members.enabled, true),
        poolId === null ? sql`1 = 1` : eq(members.poolId, poolId),
        sanitized === "" ? sql`1 = 1` : like(members.nameLower, `${sanitized}%`),
      ),
    )
    .orderBy(members.nameLower)
    .limit(CARI_MEMBER_LIMIT);
  if (memberRows.length === 0) return [];
  const cardRows = await db
    .select({
      id: cards.id,
      memberId: cards.memberId,
      photoNo: cards.photoNo,
      rarity: cards.rarity,
    })
    .from(cards)
    .where(
      and(
        sql`${cards.memberId} IN (${sql.join(memberRows.map((m) => sql`${m.id}`), sql`, `)})`,
        eq(cards.enabled, true),
      ),
    )
    .orderBy(cards.photoNo)
    .limit(memberRows.length * CARI_CARD_LIMIT);
  const byMember = new Map<string, CariCard[]>();
  for (const c of cardRows) {
    const list = byMember.get(c.memberId) ?? [];
    if (list.length < CARI_CARD_LIMIT) {
      list.push({ cardId: c.id, photoNo: c.photoNo, rarity: c.rarity, owners: [] });
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
