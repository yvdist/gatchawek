import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { cards, groups, members, pools, type Rarity } from "../schema.js";
import { clampListPage, LIST_PAGE_SIZE } from "../../domain/list.js";
import { nativeBatch, type Db } from "../client.js";

export type VisibleRarity = Exclude<Rarity, "secret">;

export interface ListFilters {
  poolId: string | null;
  groupId: string | null;
}

export interface ListCardRow {
  cardId: string;
  serial: number;
  photoNo: number;
  photoLabel: string | null;
  rarity: VisibleRarity;
  holoEnabled: boolean;
  memberId: string;
  memberName: string;
  groupId: string;
  groupName: string;
  groupBadge: string;
  poolId: string;
  poolName: string;
  poolEmoji: string;
}

export interface ListPageResult {
  cards: ListCardRow[];
  totalCards: number;
  totalPages: number;
  page: number;
  poolName: string | null;
  poolEmoji: string | null;
  groupName: string | null;
  groupBadge: string | null;
}

export type ListOutcome =
  | ({ status: "ok" } & ListPageResult)
  | { status: "unknown-pool" }
  | { status: "unknown-group" }
  | { status: "empty" };

interface RawListCardRow {
  card_id: string;
  serial: number;
  photo_no: number;
  photo_label: string | null;
  rarity: VisibleRarity;
  holo_enabled: number;
  member_id: string;
  member_name: string;
  group_id: string;
  group_name: string;
  group_badge: string;
  pool_id: string;
  pool_name: string;
  pool_emoji: string;
}

/**
 * Returns one page of enabled, non-secret cards filtered by optional pool and/or
 * group. Secret cards (`rarity = 'secret'`) are never queried or counted.
 */
export async function getListPage(
  db: Db,
  filters: ListFilters,
  requestedPage: number,
): Promise<ListOutcome> {
  let scopePool: { id: string; name: string; emoji: string } | null = null;
  if (filters.poolId !== null) {
    const poolRows = await db
      .select({ id: pools.id, name: pools.name, emoji: pools.emoji })
      .from(pools)
      .where(and(eq(pools.id, filters.poolId), eq(pools.enabled, true)))
      .limit(1);
    const pool = poolRows[0];
    if (pool === undefined) return { status: "unknown-pool" };
    scopePool = pool;
  }

  let scopeGroup: { id: string; name: string; badge: string } | null = null;
  if (filters.groupId !== null) {
    const groupWhere =
      filters.poolId === null
        ? and(eq(groups.id, filters.groupId), eq(groups.enabled, true))
        : and(
            eq(groups.id, filters.groupId),
            eq(groups.poolId, filters.poolId),
            eq(groups.enabled, true),
          );
    const groupRows = await db
      .select({ id: groups.id, name: groups.name, badge: groups.badge })
      .from(groups)
      .where(groupWhere)
      .limit(1);
    const group = groupRows[0];
    if (group === undefined) return { status: "unknown-group" };
    scopeGroup = group;
  }

  const baseWhere = sql`${cards.enabled} = 1 AND ${cards.rarity} != 'secret' AND ${members.enabled} = 1 AND ${groups.enabled} = 1 AND ${pools.enabled} = 1`;
  const poolFilter =
    filters.poolId === null ? sql`` : sql` AND ${cards.poolId} = ${filters.poolId}`;
  const groupFilter =
    filters.groupId === null ? sql`` : sql` AND ${cards.groupId} = ${filters.groupId}`;
  const fullWhere = sql`${baseWhere}${poolFilter}${groupFilter}`;

  const countResults = await nativeBatch(db, [
    sql`SELECT COUNT(*) AS n FROM ${cards} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${fullWhere}`,
  ]);
  const totalCards = Number(
    (countResults[0]?.results?.[0] as { n?: number } | undefined)?.n ?? 0,
  );
  if (totalCards === 0) return { status: "empty" };

  const totalPages = Math.ceil(totalCards / LIST_PAGE_SIZE);
  const page = clampListPage(requestedPage, totalPages);

  const pageResults = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS card_id, ${cards.serial} AS serial, ${cards.photoNo} AS photo_no, ${cards.photoLabel} AS photo_label, ${cards.rarity} AS rarity, ${cards.holoEnabled} AS holo_enabled, ${members.id} AS member_id, ${members.name} AS member_name, ${groups.id} AS group_id, ${groups.name} AS group_name, ${groups.badge} AS group_badge, ${pools.id} AS pool_id, ${pools.name} AS pool_name, ${pools.emoji} AS pool_emoji FROM ${cards} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${fullWhere} ORDER BY ${pools.sortOrder}, ${groups.sortOrder}, ${members.sortOrder}, ${members.nameLower}, ${cards.photoNo} LIMIT ${LIST_PAGE_SIZE} OFFSET ${page * LIST_PAGE_SIZE}`,
  ]);

  const rawRows = (pageResults[0]?.results ?? []) as unknown as RawListCardRow[];
  const listCards: ListCardRow[] = rawRows.map((r) => ({
    cardId: r.card_id,
    serial: r.serial,
    photoNo: r.photo_no,
    photoLabel: r.photo_label,
    rarity: r.rarity,
    holoEnabled: Boolean(r.holo_enabled),
    memberId: r.member_id,
    memberName: r.member_name,
    groupId: r.group_id,
    groupName: r.group_name,
    groupBadge: r.group_badge,
    poolId: r.pool_id,
    poolName: r.pool_name,
    poolEmoji: r.pool_emoji,
  }));

  return {
    status: "ok",
    cards: listCards,
    totalCards,
    totalPages,
    page,
    poolName: scopePool?.name ?? null,
    poolEmoji: scopePool?.emoji ?? null,
    groupName: scopeGroup?.name ?? null,
    groupBadge: scopeGroup?.badge ?? null,
  };
}

export async function searchListPools(
  db: Db,
  typed: string,
): Promise<{ id: string; name: string; emoji: string }[]> {
  const sanitized = typed.replace(/[%_\\]/g, "");
  return db
    .select({ id: pools.id, name: pools.name, emoji: pools.emoji })
    .from(pools)
    .where(
      and(
        eq(pools.enabled, true),
        sanitized === ""
          ? sql`1 = 1`
          : or(like(pools.name, `%${sanitized}%`), like(pools.id, `%${sanitized}%`)),
      ),
    )
    .orderBy(asc(pools.sortOrder), asc(pools.name))
    .limit(25);
}

export async function searchListGroups(
  db: Db,
  poolId: string | null,
  typed: string,
): Promise<{ id: string; name: string; badge: string; poolId: string }[]> {
  const sanitized = typed.replace(/[%_\\]/g, "");
  const hasVisibleCard = sql`EXISTS (SELECT 1 FROM ${cards} JOIN ${members} ON ${members.id} = ${cards.memberId} WHERE ${cards.groupId} = ${groups.id} AND ${cards.enabled} = 1 AND ${cards.rarity} != 'secret' AND ${members.enabled} = 1)`;

  const validPool =
    poolId !== null && poolId !== ""
      ? (
          await db
            .select({ id: pools.id })
            .from(pools)
            .where(and(eq(pools.id, poolId), eq(pools.enabled, true)))
            .limit(1)
        )[0]
      : undefined;

  return db
    .select({
      id: groups.id,
      name: groups.name,
      badge: groups.badge,
      poolId: groups.poolId,
    })
    .from(groups)
    .where(
      and(
        eq(groups.enabled, true),
        hasVisibleCard,
        validPool !== undefined ? eq(groups.poolId, validPool.id) : sql`1 = 1`,
        sanitized === ""
          ? sql`1 = 1`
          : or(like(groups.name, `%${sanitized}%`), like(groups.id, `%${sanitized}%`)),
      ),
    )
    .orderBy(asc(groups.poolId), asc(groups.sortOrder), asc(groups.name))
    .limit(25);
}
