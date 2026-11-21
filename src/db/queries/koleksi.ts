import { and, asc, eq, sql } from "drizzle-orm";
import { cards, groups, members, pools, userCards } from "../schema.js";
import { clampPage, PAGE_SIZE } from "../../domain/koleksi.js";
import { RARITY_KEYS, type RarityKey } from "../../domain/rarity.js";
import { nativeBatch, type Db } from "../client.js";
import {
  GROUP_POOL_NOT_HIDDEN_SQL,
  visiblePool,
} from "./poolVisibility.js";

export interface KoleksiFilters {
  poolId: string;
  /** Null means all groups in the pool. `"*"` never reaches here. */
  groupId: string | null;
}

export interface OwnedPhoto {
  cardId: string;
  photoNo: number;
  quantity: number;
  rarity: RarityKey;
  photoLabel: string | null;
}

export interface OwnedMemberRow {
  memberId: string;
  memberName: string;
  photoTotal: number;
  groupId: string;
  groupName: string;
  groupBadge: string;
  ownedPhotos: number;
  photos: OwnedPhoto[];
}

export interface KoleksiPageResult {
  members: OwnedMemberRow[];
  totalMembers: number;
  totalPages: number;
  page: number;
  groupOwned: number;
  groupTotal: number;
  poolName: string;
  poolEmoji: string;
  groupName: string | null;
}

export type KoleksiOutcome =
  | ({ status: "ok" } & KoleksiPageResult)
  | { status: "unknown-pool" }
  | { status: "unknown-group" }
  | { status: "empty" };

export interface HelpCatalog {
  pools: {
    id: string;
    name: string;
    emoji: string;
    groups: {
      id: string;
      name: string;
      memberCount: number;
    }[];
  }[];
}

interface RawPageRow {
  member_id: string;
  member_name: string;
  photo_total: number;
  group_id: string;
  group_name: string;
  group_badge: string;
  owned_photos: number;
  blob: string | null;
}

/** Blob packs photo entries with ASCII control separators (0x1E field, 0x1F
 * entry) so display labels with commas/colons survive the round-trip. */
function parseBlob(blob: string | null): OwnedPhoto[] {
  if (blob === null || blob === "") return [];
  const out: OwnedPhoto[] = [];
  for (const part of blob.split("\u001F")) {
    const [cardId, noRaw, qtyRaw, rarityRaw, labelRaw] = part.split("\u001E");
    const photoNo = Number(noRaw);
    const quantity = Number(qtyRaw);
    if (
      cardId === undefined ||
      cardId === "" ||
      noRaw === undefined ||
      qtyRaw === undefined ||
      rarityRaw === undefined ||
      !Number.isInteger(photoNo) ||
      !Number.isInteger(quantity) ||
      photoNo <= 0 ||
      quantity <= 0 ||
      !(RARITY_KEYS as readonly string[]).includes(rarityRaw)
    ) {
      continue;
    }
    out.push({
      cardId,
      photoNo,
      quantity,
      rarity: rarityRaw as RarityKey,
      photoLabel: labelRaw === undefined || labelRaw === "" ? null : labelRaw,
    });
  }
  out.sort((a, b) => a.photoNo - b.photoNo);
  return out;
}

export async function getKoleksiPage(
  db: Db,
  userId: string,
  filters: KoleksiFilters,
  requestedPage: number,
): Promise<KoleksiOutcome> {
  const poolRows = await db
    .select()
    .from(pools)
    .where(and(eq(pools.id, filters.poolId), visiblePool()))
    .limit(1);
  const pool = poolRows[0];
  if (pool === undefined) return { status: "unknown-pool" };

  let scopeGroup: typeof groups.$inferSelect | null = null;
  if (filters.groupId !== null) {
    const groupRows = await db
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.id, filters.groupId),
          eq(groups.poolId, filters.poolId),
          eq(groups.enabled, true),
        ),
      )
      .limit(1);
    const group = groupRows[0];
    if (group === undefined) return { status: "unknown-group" };
    scopeGroup = group;
  }

  const scopeCondition =
    filters.groupId === null
      ? sql`${userCards.userId} = ${userId} AND ${cards.poolId} = ${filters.poolId} AND ${cards.enabled} = 1`
      : sql`${userCards.userId} = ${userId} AND ${cards.poolId} = ${filters.poolId} AND ${cards.groupId} = ${filters.groupId} AND ${cards.enabled} = 1`;

  const countResults = await nativeBatch(db, [
    sql`SELECT COUNT(DISTINCT ${cards.memberId}) AS n FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} WHERE ${scopeCondition}`,
  ]);
  const totalMembers = Number(
    (countResults[0]?.results?.[0] as { n?: number } | undefined)?.n ?? 0,
  );
  if (totalMembers === 0) return { status: "empty" };

  const totalPages = Math.ceil(totalMembers / PAGE_SIZE);
  const page = clampPage(requestedPage, totalPages);

  const pageResults = await nativeBatch(db, [
    sql`SELECT ${members.id} AS member_id, ${members.name} AS member_name, ${members.photoTotal} AS photo_total, ${members.groupId} AS group_id, ${groups.name} AS group_name, ${groups.badge} AS group_badge, COUNT(DISTINCT ${userCards.cardId}) AS owned_photos, GROUP_CONCAT(${cards.id} || char(30) || ${cards.photoNo} || char(30) || ${userCards.quantity} || char(30) || ${cards.rarity} || char(30) || IFNULL(${cards.photoLabel}, ''), char(31)) AS blob FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} WHERE ${scopeCondition} GROUP BY ${members.id} ORDER BY ${members.sortOrder}, ${members.name} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
  ]);
  const rawRows = (pageResults[0]?.results ?? []) as unknown as RawPageRow[];
  const pageMembers: OwnedMemberRow[] = rawRows.map((row) => ({
    memberId: row.member_id,
    memberName: row.member_name,
    photoTotal: row.photo_total,
    groupId: row.group_id,
    groupName: row.group_name,
    groupBadge: row.group_badge,
    ownedPhotos: row.owned_photos,
    photos: parseBlob(row.blob),
  }));

  let groupOwned = totalMembers;
  let groupTotal = pool.memberCount;
  let groupName: string | null = null;
  if (scopeGroup !== null) {
    const [distinctRows] = await db.batch([
      db
        .select({ n: sql<number>`count(distinct ${cards.memberId})` })
        .from(userCards)
        .innerJoin(cards, eq(userCards.cardId, cards.id))
        .where(
          and(
            eq(userCards.userId, userId),
            eq(cards.groupId, scopeGroup.id),
            eq(cards.enabled, true),
          ),
        ),
    ]);
    groupOwned = distinctRows[0]?.n ?? 0;
    groupTotal = scopeGroup.memberCount;
    groupName = scopeGroup.name;
  }

  return {
    status: "ok",
    members: pageMembers,
    totalMembers,
    totalPages,
    page,
    groupOwned,
    groupTotal,
    poolName: pool.name,
    poolEmoji: pool.emoji,
    groupName,
  };
}

export async function getHelpCatalog(db: Db): Promise<HelpCatalog> {
  const [poolRows, groupRows] = await db.batch([
    db
      .select()
      .from(pools)
      .where(visiblePool())
      .orderBy(asc(pools.sortOrder)),
    db
      .select()
      .from(groups)
      .where(and(eq(groups.enabled, true), GROUP_POOL_NOT_HIDDEN_SQL))
      .orderBy(asc(groups.poolId), asc(groups.sortOrder)),
  ]);
  const byPool = new Map<string, HelpCatalog["pools"][number]>();
  for (const pool of poolRows) {
    byPool.set(pool.id, {
      id: pool.id,
      name: pool.name,
      emoji: pool.emoji,
      groups: [],
    });
  }
  for (const group of groupRows) {
    byPool.get(group.poolId)?.groups.push({
      id: group.id,
      name: group.name,
      memberCount: group.memberCount,
    });
  }
  return { pools: [...byPool.values()] };
}
