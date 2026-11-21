import { and, eq } from "drizzle-orm";
import { cards, groups, members, pools } from "../schema.js";
import type { Db } from "../client.js";
import type { RarityKey } from "../../domain/rarity.js";

export interface ShareableCard {
  cardId: string;
  memberName: string;
  photoLabel: string | null;
  groupName: string;
  photoNo: number;
  photoTotal: number;
  serial: number;
  rarity: RarityKey;
  imageFile: string;
  enabled: boolean;
}

/** Public card lookup for the /kartu/<id> share page (no ownership needed). */
export async function getShareableCard(
  db: Db,
  cardId: string,
): Promise<ShareableCard | null> {
  const rows = await db
    .select({
      cardId: cards.id,
      memberName: members.name,
      photoLabel: cards.photoLabel,
      groupName: groups.name,
      photoNo: cards.photoNo,
      photoTotal: members.photoTotal,
      serial: cards.serial,
      rarity: cards.rarity,
      imageFile: cards.imageFile,
      enabled: cards.enabled,
    })
    .from(cards)
    .innerJoin(members, eq(cards.memberId, members.id))
    .innerJoin(groups, eq(cards.groupId, groups.id))
    .innerJoin(pools, eq(cards.poolId, pools.id))
    .where(and(eq(cards.id, cardId), eq(cards.enabled, true)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return { ...row, rarity: row.rarity as RarityKey };
}
