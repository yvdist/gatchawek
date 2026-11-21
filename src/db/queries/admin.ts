import { and, asc, desc, eq, inArray, like, ne, sql, type SQL } from "drizzle-orm";
import {
  cards,
  groups,
  injectQueue,
  members,
  pools,
  userCards,
  type Rarity,
} from "../schema.js";
import { nativeBatch, type Db } from "../client.js";
import { slugifyBase } from "../../domain/submissions.js";
import type { QueueRow } from "./inject.js";

export type CardImageKind = "static" | "remote" | "empty";
export type AdminCardKindFilter = "all" | CardImageKind;
export type AdminQueueStatus = "pending" | "approved" | "rejected";

/** static = served from /cards/; remote = raw http(s) URL; empty = "". */
export function classifyImageFile(imageFile: string): CardImageKind {
  if (imageFile === "") return "empty";
  if (
    imageFile.startsWith("http://") ||
    imageFile.startsWith("https://")
  ) {
    return "remote";
  }
  return "static";
}

export interface AdminCardRow {
  id: string;
  memberName: string;
  groupBadge: string;
  poolName: string;
  poolId: string;
  photoNo: number;
  rarity: Rarity;
  imageFile: string;
  imageKind: CardImageKind;
  enabled: boolean;
  quantityOwned: number;
}

export interface AdminCardDetail extends AdminCardRow {
  photoLabel: string | null;
  fullName: string | null;
  photoTotal: number;
  serial: number;
  sourcePageUrl: string | null;
  holoEnabled: boolean;
}

export interface AdminCounts {
  total: number;
  empty: number;
  remote: number;
  pending: number;
}

function escapeLike(s: string): string {
  // D1 requires a single-char ESCAPE; "/" never appears in ids/names here.
  return s.replace(/[%_/]/g, (c) => `/${c}`);
}

function cardWhere(kind: AdminCardKindFilter, q: string): SQL {
  const conds: SQL[] = [];
  if (kind === "empty") {
    conds.push(sql`${cards.imageFile} = ''`);
  } else if (kind === "remote") {
    conds.push(sql`${cards.imageFile} LIKE 'http%'`);
  } else if (kind === "static") {
    conds.push(
      sql`${cards.imageFile} != '' AND ${cards.imageFile} NOT LIKE 'http%'`,
    );
  }
  const needle = q.trim().toLowerCase();
  if (needle !== "") {
    const esc = escapeLike(needle);
    conds.push(
      sql`(${members.nameLower} LIKE ${`${esc}%`} ESCAPE '/' OR ${cards.id} LIKE ${`%${esc}%`} ESCAPE '/')`,
    );
  }
  return and(...conds) ?? sql`1 = 1`;
}

function clampLimit(limit: number): number {
  const n = Math.trunc(limit);
  if (!Number.isFinite(n)) return 50;
  return Math.min(Math.max(n, 1), 200);
}

function clampOffset(offset: number): number {
  const n = Math.trunc(offset);
  if (!Number.isFinite(n)) return 0;
  return Math.max(n, 0);
}

interface AdminCardRaw {
  id: string;
  member_name: string;
  group_badge: string;
  pool_name: string;
  pool_id: string;
  photo_no: number;
  rarity: Rarity;
  image_file: string;
  enabled: number;
  owned: number;
}

function toRow(r: AdminCardRaw): AdminCardRow {
  return {
    id: r.id,
    memberName: r.member_name,
    groupBadge: r.group_badge,
    poolName: r.pool_name,
    poolId: r.pool_id,
    photoNo: r.photo_no,
    rarity: r.rarity,
    imageFile: r.image_file,
    imageKind: classifyImageFile(r.image_file),
    enabled: Boolean(r.enabled),
    quantityOwned: Number(r.owned),
  };
}

export async function listAdminCards(
  db: Db,
  opts: {
    kind: AdminCardKindFilter;
    q: string;
    limit: number;
    offset: number;
  },
): Promise<{ rows: AdminCardRow[]; total: number }> {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const where = cardWhere(opts.kind, opts.q);
  const joinMembers = sql`JOIN ${members} ON ${members.id} = ${cards.memberId}`;
  const [rowsRes, countRes] = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${groups.badge} AS group_badge, ${pools.name} AS pool_name, ${cards.poolId} AS pool_id, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity, ${cards.imageFile} AS image_file, ${cards.enabled} AS enabled, IFNULL(SUM(${userCards.quantity}), 0) AS owned FROM ${cards} ${joinMembers} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} LEFT JOIN ${userCards} ON ${userCards.cardId} = ${cards.id} WHERE ${where} GROUP BY ${cards.id} ORDER BY ${cards.id} LIMIT ${limit} OFFSET ${offset}`,
    sql`SELECT COUNT(*) AS n FROM ${cards} ${joinMembers} WHERE ${where}`,
  ]);
  const raws = (rowsRes?.results ?? []) as unknown as AdminCardRaw[];
  const total = Number(
    (countRes?.results?.[0] as { n?: number } | undefined)?.n ?? 0,
  );
  return { rows: raws.map(toRow), total };
}

interface AdminCardDetailRaw extends AdminCardRaw {
  photo_label: string | null;
  full_name: string | null;
  photo_total: number;
  serial: number;
  source_page_url: string | null;
  holo_enabled: number;
}

export async function getAdminCard(
  db: Db,
  cardId: string,
): Promise<AdminCardDetail | null> {
  const [res] = await nativeBatch(db, [
    sql`SELECT ${cards.id} AS id, ${members.name} AS member_name, ${groups.badge} AS group_badge, ${pools.name} AS pool_name, ${cards.poolId} AS pool_id, ${cards.photoNo} AS photo_no, ${cards.rarity} AS rarity, ${cards.imageFile} AS image_file, ${cards.enabled} AS enabled, IFNULL(SUM(${userCards.quantity}), 0) AS owned, ${cards.photoLabel} AS photo_label, ${members.fullName} AS full_name, ${members.photoTotal} AS photo_total, ${cards.serial} AS serial, ${cards.sourcePageUrl} AS source_page_url, ${cards.holoEnabled} AS holo_enabled FROM ${cards} JOIN ${members} ON ${members.id} = ${cards.memberId} JOIN ${groups} ON ${groups.id} = ${cards.groupId} JOIN ${pools} ON ${pools.id} = ${cards.poolId} LEFT JOIN ${userCards} ON ${userCards.cardId} = ${cards.id} WHERE ${cards.id} = ${cardId} GROUP BY ${cards.id}`,
  ]);
  const raw = (res?.results ?? []) as unknown as AdminCardDetailRaw[];
  const r = raw[0];
  if (r === undefined) return null;
  return {
    ...toRow(r),
    photoLabel: r.photo_label,
    fullName: r.full_name,
    photoTotal: Number(r.photo_total),
    serial: Number(r.serial),
    sourcePageUrl: r.source_page_url,
    holoEnabled: Boolean(r.holo_enabled),
  };
}

export async function setAdminCardImage(
  db: Db,
  cardId: string,
  imageFile: string,
): Promise<boolean> {
  const res = await nativeBatch(db, [
    db.update(cards).set({ imageFile }).where(eq(cards.id, cardId)),
  ]);
  return (res[0]?.meta.changes ?? 0) === 1;
}

export async function setAdminCardEnabled(
  db: Db,
  cardId: string,
  enabled: boolean,
): Promise<boolean> {
  const res = await nativeBatch(db, [
    db.update(cards).set({ enabled }).where(eq(cards.id, cardId)),
  ]);
  return (res[0]?.meta.changes ?? 0) === 1;
}

export async function listAdminQueue(
  db: Db,
  status: AdminQueueStatus,
  limit: number,
  offset: number,
): Promise<{ rows: QueueRow[]; total: number }> {
  const [rows, countRows] = await db.batch([
    db
      .select()
      .from(injectQueue)
      .where(eq(injectQueue.status, status))
      .orderBy(desc(injectQueue.submittedAt))
      .limit(clampLimit(limit))
      .offset(clampOffset(offset)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(injectQueue)
      .where(eq(injectQueue.status, status)),
  ]);
  return { rows, total: countRows[0]?.n ?? 0 };
}

export async function getAdminCounts(db: Db): Promise<AdminCounts> {
  const res = await nativeBatch(db, [
    sql`SELECT COUNT(*) AS n FROM ${cards}`,
    sql`SELECT COUNT(*) AS n FROM ${cards} WHERE ${cards.imageFile} = ''`,
    sql`SELECT COUNT(*) AS n FROM ${cards} WHERE ${cards.imageFile} LIKE 'http%'`,
    sql`SELECT COUNT(*) AS n FROM ${injectQueue} WHERE ${injectQueue.status} = 'pending'`,
  ]);
  const n = (i: number): number =>
    Number((res[i]?.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  return { total: n(0), empty: n(1), remote: n(2), pending: n(3) };
}

export interface AdminPoolGroupOption {
  poolId: string;
  poolName: string;
  poolEmoji: string;
  groupId: string;
  groupName: string;
  groupBadge: string;
}

export async function listAdminPoolGroups(
  db: Db,
): Promise<AdminPoolGroupOption[]> {
  return db
    .select({
      poolId: pools.id,
      poolName: pools.name,
      poolEmoji: pools.emoji,
      groupId: groups.id,
      groupName: groups.name,
      groupBadge: groups.badge,
    })
    .from(groups)
    .innerJoin(pools, eq(groups.poolId, pools.id))
    .where(and(eq(pools.enabled, true), eq(groups.enabled, true)))
    .orderBy(asc(pools.sortOrder), asc(groups.sortOrder), asc(groups.id));
}

export interface AdminPoolOption {
  poolId: string;
  poolName: string;
  poolEmoji: string;
}

/**
 * Pools aktif untuk dropdown import (pool saja; grup ikut nama file).
 */
export async function listAdminPools(db: Db): Promise<AdminPoolOption[]> {
  return db
    .select({ poolId: pools.id, poolName: pools.name, poolEmoji: pools.emoji })
    .from(pools)
    .where(eq(pools.enabled, true))
    .orderBy(asc(pools.sortOrder), asc(pools.id));
}

export interface ImportAdminCardInput {
  poolId: string;
  groupId: string;
  nama: string;
  rarity: Rarity;
  label: string | null;
  imageUrl: string;
  messageUrl: string;
  channelId?: string | null;
  guildId?: string | null;
  now: number;
}

export interface EnsureImportGroupInput {
  poolId: string;
  groupId: string;
  name: string;
  badge: string;
}

/**
 * Auto-create a filename-derived group inside the dropdown pool. Computes
 * `sort_order` as max+1 in the pool and inserts with `ON CONFLICT DO NOTHING`
 * so a repeated call (same batch, retried request) is a safe no-op.
 */
export async function ensureImportGroup(
  db: Db,
  input: EnsureImportGroupInput,
): Promise<void> {
  const [row] = await db
    .select({ m: sql<number | null>`max(sort_order)` })
    .from(groups)
    .where(eq(groups.poolId, input.poolId));
  const sortOrder = (row?.m ?? -1) + 1;
  await db
    .insert(groups)
    .values({
      id: input.groupId,
      poolId: input.poolId,
      name: input.name,
      badge: input.badge,
      sortOrder,
      memberCount: 0,
      enabled: true,
    })
    .onConflictDoNothing();
}

export type ImportAdminCardOutcome =
  | {
      status: "ok";
      cardId: string;
      memberId: string;
      nama: string;
      rarity: Rarity;
      photoNo: number;
      serial: number;
    }
  | { status: "unknown-group" }
  | {
      status: "member-group-mismatch";
      existingPoolId: string;
      existingGroupId: string;
    }
  | { status: "conflict" }
  | { status: "invalid-input"; error: string };

/**
 * Direct-to-D1 card import from the admin GUI. Inserts a new member when
 * absent, appends the card with pool-scoped serial = max+1 and photo_no =
 * max+1, refreshes group/pool member counts, and records an approved audit row
 * in inject_queue so `seed.ts` preserves the card across future syncs.
 */
export async function importAdminCard(
  db: Db,
  input: ImportAdminCardInput,
): Promise<ImportAdminCardOutcome> {
  const nama = input.nama.trim();
  if (nama === "") {
    return { status: "invalid-input", error: "Nama kartu wajib diisi." };
  }
  const imageUrl = input.imageUrl.trim();
  if (imageUrl === "") {
    return { status: "invalid-input", error: "URL gambar wajib diisi." };
  }
  const label =
    input.label !== null && input.label.trim() !== ""
      ? input.label.trim()
      : null;

  const [groupRow] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, input.groupId), eq(groups.poolId, input.poolId)))
    .limit(1);
  if (groupRow === undefined) return { status: "unknown-group" };

  const memberId = slugifyBase(nama);
  const [memberRow] = await db
    .select({
      id: members.id,
      poolId: members.poolId,
      groupId: members.groupId,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (
    memberRow !== undefined &&
    (memberRow.poolId !== input.poolId || memberRow.groupId !== input.groupId)
  ) {
    return {
      status: "member-group-mismatch",
      existingPoolId: memberRow.poolId,
      existingGroupId: memberRow.groupId,
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [serialRow] = await db
      .select({ m: sql<number | null>`max(serial)` })
      .from(cards)
      .where(eq(cards.poolId, input.poolId));
    const serial = (serialRow?.m ?? 0) + 1;
    const [photoRow] = await db
      .select({ m: sql<number | null>`max(photo_no)` })
      .from(cards)
      .where(eq(cards.memberId, memberId));
    const photoNo = (photoRow?.m ?? 0) + 1;
    const cardId = `${memberId}-${String(photoNo).padStart(2, "0")}`;
    const rand6 = crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 6);
    const queueMessageId = `000000-gui-${String(input.now)}-${cardId}-${rand6}`;

    const stmts = [];
    if (memberRow === undefined) {
      stmts.push(
        db
          .insert(members)
          .values({
            id: memberId,
            poolId: input.poolId,
            groupId: input.groupId,
            name: nama,
            nameLower: nama.toLowerCase(),
            fullName: null,
            photoTotal: 0,
            sortOrder: 0,
            enabled: true,
          })
          .onConflictDoNothing(),
      );
    }
    stmts.push(
      db.insert(cards).values({
        id: cardId,
        poolId: input.poolId,
        groupId: input.groupId,
        memberId,
        serial,
        photoNo,
        rarity: input.rarity,
        photoLabel: label,
        imageFile: imageUrl,
        sourcePageUrl: imageUrl,
        enabled: true,
        holoEnabled: input.rarity === "holo" || input.rarity === "secret",
      }),
      db
        .update(members)
        .set({
          photoTotal: sql`${members.photoTotal} + 1`,
          enabled: true,
        })
        .where(eq(members.id, memberId)),
      db
        .update(groups)
        .set({
          memberCount: sql`(SELECT COUNT(*) FROM ${members} WHERE ${members.groupId} = ${input.groupId} AND ${members.enabled} = 1)`,
        })
        .where(eq(groups.id, input.groupId)),
      db
        .update(pools)
        .set({
          memberCount: sql`(SELECT COUNT(*) FROM ${members} WHERE ${members.poolId} = ${input.poolId} AND ${members.enabled} = 1)`,
        })
        .where(eq(pools.id, input.poolId)),
      db
        .insert(injectQueue)
        .values({
          messageId: queueMessageId,
          channelId: input.channelId ?? "admin-import",
          guildId: input.guildId ?? "admin-import",
          authorId: "admin-web",
          submittedAt: input.now,
          messageUrl: input.messageUrl,
          nama,
          memberId,
          pool: input.poolId,
          grup: input.groupId,
          rarity: input.rarity,
          label,
          sumber: imageUrl,
          imageUrl,
          status: "approved",
          errors: null,
          reviewedBy: "admin-web",
          reviewedAt: input.now,
        })
        .onConflictDoNothing(),
    );

    try {
      await nativeBatch(db, stmts);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        continue;
      }
      throw err;
    }
    return {
      status: "ok",
      cardId,
      memberId,
      nama,
      rarity: input.rarity,
      photoNo,
      serial,
    };
  }
  return { status: "conflict" };
}

export interface RenderableCard {
  id: string;
  imageFile: string;
}

/**
 * Cards eligible for cloud render: remote (http URL) + enabled. Unknown,
 * static, empty, or disabled ids are silently dropped (caller reports them
 * as skipped). Capped at 50 ids per call.
 */
export async function listRenderableCards(
  db: Db,
  ids: readonly string[],
): Promise<RenderableCard[]> {
  const clean = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))].slice(0, 50);
  if (clean.length === 0) return [];
  const rows = await db
    .select({ id: cards.id, imageFile: cards.imageFile })
    .from(cards)
    .where(
      and(
        inArray(cards.id, clean),
        like(cards.imageFile, "http%"),
        eq(cards.enabled, true),
        ne(cards.poolId, "pejabat"),
      ),
    );
  return rows;
}

/**
 * Tukar nama member ↔ label foto untuk satu kartu tanpa mengganti id.
 * Id (`members.id`, `cards.id`, `memberId` slug, `serial`, `photoNo`)
 * SENGAJA dipertahankan agar stabil (slug lama tetap dipakai walau tidak
 * lagi cocok dengan nama baru) — merename id merusak FK `user_cards`,
 * `inject_queue`, dan URL `/cards/<file>`.
 */
export async function swapCardMemberLabel(
  db: Db,
  cardId: string,
): Promise<{ status: "ok" | "not-found" | "no-label"; memberName: string; photoLabel: string | null }> {
  const current = await db
    .select({ id: cards.id, memberId: cards.memberId, photoLabel: cards.photoLabel, memberName: members.name })
    .from(cards)
    .innerJoin(members, eq(members.id, cards.memberId))
    .where(eq(cards.id, cardId))
    .limit(1);
  const row = current[0];
  if (row === undefined) return { status: "not-found", memberName: "", photoLabel: null };
  if (row.photoLabel === null) return { status: "no-label", memberName: row.memberName, photoLabel: null };
  const newMemberName = row.photoLabel;
  const newLabel = row.memberName;
  await nativeBatch(db, [
    db.update(members).set({ name: newMemberName, nameLower: newMemberName.toLowerCase() }).where(eq(members.id, row.memberId)),
    db.update(cards).set({ photoLabel: newLabel }).where(eq(cards.id, cardId)),
  ]);
  return { status: "ok", memberName: newMemberName, photoLabel: newLabel };
}

/**
 * Promosikan label foto menjadi nama member, lalu kosongkan label.
 * Untuk kasus "kebalik" di mana label berisi nama orang utuh
 * (mis. member "Isal" + label "Isal Kemesraan") — hasil akhir satu baris
 * judul, konsisten dengan kartu tanpa label. Id/slug dipertahankan
 * (alasan sama seperti swapCardMemberLabel).
 */
export async function promoteCardLabelToMember(
  db: Db,
  cardId: string,
): Promise<{ status: "ok" | "not-found" | "no-label"; memberName: string; photoLabel: string | null }> {
  const current = await db
    .select({ id: cards.id, memberId: cards.memberId, photoLabel: cards.photoLabel, memberName: members.name })
    .from(cards)
    .innerJoin(members, eq(members.id, cards.memberId))
    .where(eq(cards.id, cardId))
    .limit(1);
  const row = current[0];
  if (row === undefined) return { status: "not-found", memberName: "", photoLabel: null };
  if (row.photoLabel === null) return { status: "no-label", memberName: row.memberName, photoLabel: null };
  const newMemberName = row.photoLabel;
  await nativeBatch(db, [
    db.update(members).set({ name: newMemberName, nameLower: newMemberName.toLowerCase() }).where(eq(members.id, row.memberId)),
    db.update(cards).set({ photoLabel: null }).where(eq(cards.id, cardId)),
  ]);
  return { status: "ok", memberName: newMemberName, photoLabel: null };
}
