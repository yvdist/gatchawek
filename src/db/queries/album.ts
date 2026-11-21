import { and, asc, eq, like, sql } from "drizzle-orm";
import {
  albumTokens,
  cards,
  groups,
  members,
  pools,
  userCards,
} from "../schema.js";
import { nativeBatch, type Db } from "../client.js";
import { VISIBLE_POOL_SQL, visiblePool } from "./poolVisibility.js";
import {
  albumExpiry,
  maskAlbumSlot,
  type AlbumBinderSlot,
  type RawAlbumCardSlot,
} from "../../domain/album.js";
import type { RarityKey } from "../../domain/rarity.js";

export interface AlbumSummaryStats {
  readonly uniqueOwnedCards: number;
  readonly totalCatalogCards: number;
  readonly uniqueOwnedMembers: number;
  readonly totalCatalogMembers: number;
  readonly totalCopies: number;
  readonly totalHoloCopies: number;
}

export type CreateAlbumTokenOutcome =
  | {
      readonly status: "ok";
      readonly token: string;
      readonly expiresAt: number;
      readonly poolName: string | null;
      readonly poolEmoji: string | null;
      readonly summary: AlbumSummaryStats;
    }
  | { readonly status: "unknown-pool" };

export interface AlbumPoolTab {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly ownedCards: number;
  readonly totalCards: number;
  readonly ownedMembers: number;
  readonly totalMembers: number;
}

export interface AlbumGroupTab {
  readonly id: string;
  readonly poolId: string;
  readonly name: string;
  readonly badge: string;
  readonly ownedCards: number;
  readonly totalCards: number;
  readonly ownedMembers: number;
  readonly totalMembers: number;
}

export interface AlbumBinderData {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly initialPoolId: string | null;
  readonly generatedAt: number;
  readonly summary: AlbumSummaryStats;
  readonly pools: readonly AlbumPoolTab[];
  readonly groups: readonly AlbumGroupTab[];
  readonly slots: readonly AlbumBinderSlot[];
}

export type RedeemAlbumTokenOutcome =
  | { readonly status: "ok"; readonly binder: AlbumBinderData }
  | { readonly status: "not-found" }
  | { readonly status: "already-used"; readonly usedAt: number }
  | { readonly status: "expired"; readonly expiresAt: number };

export async function searchAlbumPools(
  db: Db,
  prefix: string,
): Promise<{ name: string; value: string }[]> {
  const sanitized = prefix.replace(/[%_\\]/g, "").trim();
  const whereClause =
    sanitized === ""
      ? visiblePool()
      : and(visiblePool(), like(pools.name, `%${sanitized}%`));
  const rows = await db
    .select({ id: pools.id, name: pools.name, emoji: pools.emoji })
    .from(pools)
    .where(whereClause)
    .orderBy(asc(pools.sortOrder), asc(pools.name))
    .limit(25);
  return rows.map((r) => ({
    name: `${r.emoji} ${r.name}`.slice(0, 100),
    value: r.id,
  }));
}

export async function createAlbumToken(
  db: Db,
  args: {
    token: string;
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    poolId: string | null;
    now: number;
  },
): Promise<CreateAlbumTokenOutcome> {
  let poolMeta: { id: string; name: string; emoji: string } | null = null;
  if (args.poolId !== null) {
    const found = await db
      .select({ id: pools.id, name: pools.name, emoji: pools.emoji })
      .from(pools)
      .where(and(eq(pools.id, args.poolId), visiblePool()))
      .limit(1);
    if (found[0] === undefined) {
      return { status: "unknown-pool" };
    }
    poolMeta = found[0];
  }

  const expiresAt = albumExpiry(args.now);

  const results = await nativeBatch(db, [
    sql`INSERT OR IGNORE INTO users (id, created_at) VALUES (${args.userId}, ${args.now})`,
    sql`DELETE FROM ${albumTokens} WHERE ${albumTokens.userId} = ${args.userId}`,
    sql`INSERT INTO ${albumTokens} (token, user_id, display_name, avatar_url, pool_id, settle_token, created_at, expires_at, used_at) VALUES (${args.token}, ${args.userId}, ${args.displayName}, ${args.avatarUrl}, ${args.poolId}, NULL, ${args.now}, ${expiresAt}, NULL)`,
    sql`SELECT COUNT(*) AS total_cards, COUNT(DISTINCT ${cards.memberId}) AS total_members FROM ${cards} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${cards.enabled} = 1 AND ${members.enabled} = 1 AND ${groups.enabled} = 1 AND ${VISIBLE_POOL_SQL}`,
    sql`SELECT COUNT(*) AS owned_cards, COUNT(DISTINCT ${cards.memberId}) AS owned_members, COALESCE(SUM(${userCards.quantity} + ${userCards.holoQty}), 0) AS total_copies, COALESCE(SUM(${userCards.holoQty}), 0) AS total_holo FROM ${userCards} JOIN ${cards} ON ${cards.id} = ${userCards.cardId} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} WHERE ${userCards.userId} = ${args.userId} AND (${userCards.quantity} + ${userCards.holoQty}) >= 1 AND ${cards.enabled} = 1 AND ${members.enabled} = 1 AND ${groups.enabled} = 1 AND ${VISIBLE_POOL_SQL}`,
  ]);

  const catRow = (results[3]?.results?.[0] ?? {}) as {
    total_cards?: number;
    total_members?: number;
  };
  const ownRow = (results[4]?.results?.[0] ?? {}) as {
    owned_cards?: number;
    owned_members?: number;
    total_copies?: number;
    total_holo?: number;
  };

  return {
    status: "ok",
    token: args.token,
    expiresAt,
    poolName: poolMeta?.name ?? null,
    poolEmoji: poolMeta?.emoji ?? null,
    summary: {
      uniqueOwnedCards: Number(ownRow.owned_cards ?? 0),
      totalCatalogCards: Number(catRow.total_cards ?? 0),
      uniqueOwnedMembers: Number(ownRow.owned_members ?? 0),
      totalCatalogMembers: Number(catRow.total_members ?? 0),
      totalCopies: Number(ownRow.total_copies ?? 0),
      totalHoloCopies: Number(ownRow.total_holo ?? 0),
    },
  };
}

interface RawTokenRow {
  token: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  pool_id: string | null;
  settle_token: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

interface RawCatalogSlotRow {
  card_id: string;
  pool_id: string;
  group_id: string;
  member_id: string;
  member_name: string;
  full_name: string | null;
  photo_label: string | null;
  serial: number;
  photo_no: number;
  photo_total: number;
  rarity: RarityKey;
  holo_enabled: number;
  image_file: string;
  quantity: number | null;
  holo_qty: number | null;
  first_obtained_at: number | null;
  last_obtained_at: number | null;
}

export async function redeemAlbumToken(
  db: Db,
  args: {
    token: string;
    claimToken: string;
    now: number;
    publicBaseUrl: string;
  },
): Promise<RedeemAlbumTokenOutcome> {
  const claimResults = await nativeBatch(db, [
    sql`UPDATE ${albumTokens} SET used_at = ${args.now}, settle_token = ${args.claimToken} WHERE ${albumTokens.token} = ${args.token} AND ${albumTokens.usedAt} IS NULL AND ${albumTokens.expiresAt} > ${args.now}`,
    sql`SELECT token, user_id, display_name, avatar_url, pool_id, settle_token, created_at, expires_at, used_at FROM ${albumTokens} WHERE ${albumTokens.token} = ${args.token} LIMIT 1`,
  ]);

  const tokenRow = (claimResults[1]?.results?.[0] ?? undefined) as
    | RawTokenRow
    | undefined;
  if (tokenRow === undefined) {
    return { status: "not-found" };
  }
  if (tokenRow.settle_token !== args.claimToken) {
    if (tokenRow.used_at !== null) {
      return { status: "already-used", usedAt: tokenRow.used_at };
    }
    return { status: "expired", expiresAt: tokenRow.expires_at };
  }

  const dataResults = await nativeBatch(db, [
    sql`SELECT ${pools.id} AS id, ${pools.name} AS name, ${pools.emoji} AS emoji FROM ${pools} WHERE ${VISIBLE_POOL_SQL} ORDER BY ${pools.sortOrder}, ${pools.id}`,
    sql`SELECT ${groups.id} AS id, ${groups.poolId} AS pool_id, ${groups.name} AS name, ${groups.badge} AS badge FROM ${groups} JOIN ${pools} ON ${pools.id} = ${groups.poolId} WHERE ${groups.enabled} = 1 AND ${VISIBLE_POOL_SQL} ORDER BY ${pools.sortOrder}, ${groups.sortOrder}, ${groups.id}`,
    sql`SELECT ${cards.id} AS card_id, ${cards.poolId} AS pool_id, ${cards.groupId} AS group_id, ${cards.memberId} AS member_id, ${members.name} AS member_name, ${members.fullName} AS full_name, ${cards.photoLabel} AS photo_label, ${cards.serial} AS serial, ${cards.photoNo} AS photo_no, ${members.photoTotal} AS photo_total, ${cards.rarity} AS rarity, ${cards.holoEnabled} AS holo_enabled, ${cards.imageFile} AS image_file, ${userCards.quantity} AS quantity, ${userCards.holoQty} AS holo_qty, ${userCards.firstObtainedAt} AS first_obtained_at, ${userCards.lastObtainedAt} AS last_obtained_at FROM ${cards} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} LEFT JOIN ${userCards} ON ${userCards.cardId} = ${cards.id} AND ${userCards.userId} = ${tokenRow.user_id} WHERE ${cards.enabled} = 1 AND ${members.enabled} = 1 AND ${groups.enabled} = 1 AND ${VISIBLE_POOL_SQL} ORDER BY ${pools.sortOrder}, ${groups.sortOrder}, ${cards.serial}, ${members.sortOrder}, ${cards.photoNo}`,
  ]);

  const rawPools = (dataResults[0]?.results ?? []) as unknown as {
    id: string;
    name: string;
    emoji: string;
  }[];
  const rawGroups = (dataResults[1]?.results ?? []) as unknown as {
    id: string;
    pool_id: string;
    name: string;
    badge: string;
  }[];
  const rawSlots = (dataResults[2]?.results ?? []) as unknown as RawCatalogSlotRow[];

  const slots: AlbumBinderSlot[] = [];
  const allTotalMembers = new Set<string>();
  const allOwnedMembers = new Set<string>();
  let uniqueOwnedCards = 0;
  let totalCopies = 0;
  let totalHoloCopies = 0;

  const poolStats = new Map<
    string,
    {
      ownedCards: number;
      totalCards: number;
      ownedMembers: Set<string>;
      totalMembers: Set<string>;
    }
  >();
  for (const p of rawPools) {
    poolStats.set(p.id, {
      ownedCards: 0,
      totalCards: 0,
      ownedMembers: new Set(),
      totalMembers: new Set(),
    });
  }

  const groupStats = new Map<
    string,
    {
      ownedCards: number;
      totalCards: number;
      ownedMembers: Set<string>;
      totalMembers: Set<string>;
    }
  >();
  for (const g of rawGroups) {
    groupStats.set(g.id, {
      ownedCards: 0,
      totalCards: 0,
      ownedMembers: new Set(),
      totalMembers: new Set(),
    });
  }

  for (const r of rawSlots) {
    const rawSlot: RawAlbumCardSlot = {
      cardId: r.card_id,
      poolId: r.pool_id,
      groupId: r.group_id,
      memberId: r.member_id,
      memberName: r.member_name,
      fullName: r.full_name,
      photoLabel: r.photo_label,
      serial: Number(r.serial),
      photoNo: Number(r.photo_no),
      photoTotal: Number(r.photo_total),
      rarity: r.rarity,
      holoEnabled: Boolean(r.holo_enabled),
      imageFile: r.image_file,
      quantity: Number(r.quantity ?? 0),
      holoQty: Number(r.holo_qty ?? 0),
      firstObtainedAt:
        r.first_obtained_at === null ? null : Number(r.first_obtained_at),
      lastObtainedAt:
        r.last_obtained_at === null ? null : Number(r.last_obtained_at),
    };
    const slot = maskAlbumSlot(rawSlot, args.publicBaseUrl);
    slots.push(slot);

    allTotalMembers.add(slot.memberId);
    const ps = poolStats.get(slot.poolId);
    if (ps !== undefined) {
      ps.totalCards += 1;
      ps.totalMembers.add(slot.memberId);
    }
    const gs = groupStats.get(slot.groupId);
    if (gs !== undefined) {
      gs.totalCards += 1;
      gs.totalMembers.add(slot.memberId);
    }

    if (slot.owned) {
      uniqueOwnedCards += 1;
      totalCopies += slot.totalCopies;
      totalHoloCopies += slot.holoQty;
      allOwnedMembers.add(slot.memberId);
      if (ps !== undefined) {
        ps.ownedCards += 1;
        ps.ownedMembers.add(slot.memberId);
      }
      if (gs !== undefined) {
        gs.ownedCards += 1;
        gs.ownedMembers.add(slot.memberId);
      }
    }
  }

  const poolTabs: AlbumPoolTab[] = rawPools.map((p) => {
    const ps = poolStats.get(p.id);
    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      ownedCards: ps?.ownedCards ?? 0,
      totalCards: ps?.totalCards ?? 0,
      ownedMembers: ps?.ownedMembers.size ?? 0,
      totalMembers: ps?.totalMembers.size ?? 0,
    };
  });

  const groupTabs: AlbumGroupTab[] = rawGroups.map((g) => {
    const gs = groupStats.get(g.id);
    return {
      id: g.id,
      poolId: g.pool_id,
      name: g.name,
      badge: g.badge,
      ownedCards: gs?.ownedCards ?? 0,
      totalCards: gs?.totalCards ?? 0,
      ownedMembers: gs?.ownedMembers.size ?? 0,
      totalMembers: gs?.totalMembers.size ?? 0,
    };
  });

  return {
    status: "ok",
    binder: {
      userId: tokenRow.user_id,
      displayName: tokenRow.display_name,
      avatarUrl: tokenRow.avatar_url,
      initialPoolId:
        tokenRow.pool_id !== null &&
        poolTabs.some((p) => p.id === tokenRow.pool_id)
          ? tokenRow.pool_id
          : null,
      generatedAt: args.now,
      summary: {
        uniqueOwnedCards,
        totalCatalogCards: slots.length,
        uniqueOwnedMembers: allOwnedMembers.size,
        totalCatalogMembers: allTotalMembers.size,
        totalCopies,
        totalHoloCopies,
      },
      pools: poolTabs,
      groups: groupTabs,
      slots,
    },
  };
}
