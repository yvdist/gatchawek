import { and, asc, eq, sql } from "drizzle-orm";
import {
  cards,
  groups,
  injectQueue,
  members,
  pools,
  type Rarity,
} from "../schema.js";
import { nativeBatch, type Db } from "../client.js";
import { QUEUE_POOL_NOT_HIDDEN_SQL, visiblePool } from "./poolVisibility.js";

export interface QueueRow {
  messageId: string;
  channelId: string;
  guildId: string;
  authorId: string | null;
  submittedAt: number;
  messageUrl: string;
  nama: string | null;
  memberId: string | null;
  pool: string | null;
  grup: string | null;
  rarity: Rarity | null;
  label: string | null;
  sumber: string | null;
  imageUrl: string | null;
  status: "pending" | "approved" | "rejected";
  errors: string | null;
}

export interface QueueInsert extends Omit<QueueRow, "status" | "errors"> {
  status?: QueueRow["status"];
  errors?: string | null;
}

/** Idempotent insert: re-polling the same message never duplicates. */
export async function enqueueMessage(db: Db, row: QueueInsert): Promise<boolean> {
  const [existing] = await db
    .select({ messageId: injectQueue.messageId })
    .from(injectQueue)
    .where(eq(injectQueue.messageId, row.messageId))
    .limit(1);
  if (existing !== undefined) return false;
  await db.insert(injectQueue).values({
    messageId: row.messageId,
    channelId: row.channelId,
    guildId: row.guildId,
    authorId: row.authorId,
    submittedAt: row.submittedAt,
    messageUrl: row.messageUrl,
    nama: row.nama,
    memberId: row.memberId,
    pool: row.pool,
    grup: row.grup,
    rarity: row.rarity,
    label: row.label,
    sumber: row.sumber,
    imageUrl: row.imageUrl,
    status: row.status ?? "pending",
    errors: row.errors ?? null,
  });
  return true;
}

export async function oldestPending(db: Db): Promise<QueueRow | null> {
  const [row] = await db
    .select()
    .from(injectQueue)
    .where(and(eq(injectQueue.status, "pending"), QUEUE_POOL_NOT_HIDDEN_SQL))
    .orderBy(asc(injectQueue.submittedAt))
    .limit(1);
  return (row as QueueRow | undefined) ?? null;
}

export async function countPending(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(injectQueue)
    .where(and(eq(injectQueue.status, "pending"), QUEUE_POOL_NOT_HIDDEN_SQL));
  return row?.n ?? 0;
}

export type ApproveOutcome =
  | { status: "ok"; cardId: string; photoNo: number; serial: number }
  | { status: "not-pending" }
  | { status: "unknown-pool" }
  | { status: "unknown-group" };

/**
 * Direct-to-D1 approval from a phone. Inserts the member row when new and
 * the card row with pool-scoped serial = max+1 and photo_no = max+1, all in
 * one atomic batch. image_file falls back to the Discord CDN URL until the
 * next framed build overwrites it via seed.
 */
export async function approveQueued(
  db: Db,
  messageId: string,
  reviewerId: string,
  now: number,
): Promise<ApproveOutcome> {
  const [row] = await db
    .select()
    .from(injectQueue)
    .where(eq(injectQueue.messageId, messageId))
    .limit(1);
  const q = row as QueueRow | undefined;
  if (q === undefined || q.status !== "pending") return { status: "not-pending" };
  if (q.pool === null || q.grup === null || q.nama === null || q.memberId === null) {
    return { status: "not-pending" };
  }
  const [liveVpool] = await db
    .select({ id: pools.id })
    .from(pools)
    .where(and(eq(pools.id, q.pool), visiblePool()))
    .limit(1);
  if (liveVpool === undefined) return { status: "unknown-pool" };
  const [groupRow] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, q.grup), eq(groups.poolId, q.pool)))
    .limit(1);
  if (groupRow === undefined) return { status: "unknown-group" };

  const [memberRow] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, q.memberId))
    .limit(1);
  const [serialRow] = await db
    .select({ m: sql<number | null>`max(serial)` })
    .from(cards)
    .where(eq(cards.poolId, q.pool));
  const serial = (serialRow?.m ?? 0) + 1;
  const [photoRow] = await db
    .select({ m: sql<number | null>`max(photo_no)` })
    .from(cards)
    .where(eq(cards.memberId, q.memberId));
  const photoNo = (photoRow?.m ?? 0) + 1;
  const cardId = `${q.memberId}-${String(photoNo).padStart(2, "0")}`;

  const stmts = [];
  if (memberRow === undefined) {
    stmts.push(
      db
        .insert(members)
        .values({
          id: q.memberId,
          poolId: q.pool,
          groupId: q.grup,
          name: q.nama,
          nameLower: q.nama.toLowerCase(),
          fullName: null,
          photoTotal: 0,
          sortOrder: 0,
          enabled: true,
        })
        .onConflictDoNothing(),
    );
  }
  stmts.push(
    db
      .insert(cards)
      .values({
        id: cardId,
        poolId: q.pool,
        groupId: q.grup,
        memberId: q.memberId,
        serial,
        photoNo,
        rarity: (q.rarity ?? "common") as Rarity,
        photoLabel: q.label,
        imageFile: q.imageUrl ?? "",
        sourcePageUrl: q.sumber ?? q.messageUrl,
        enabled: true,
        holoEnabled: false,
      })
      .onConflictDoNothing(),
    db
      .update(members)
      .set({
        photoTotal: sql`${members.photoTotal} + 1`,
        enabled: true,
      })
      .where(eq(members.id, q.memberId)),
    db
      .update(cards)
      .set({ enabled: true })
      .where(eq(cards.id, cardId)),
    db
      .update(injectQueue)
      .set({ status: "approved", reviewedBy: reviewerId, reviewedAt: now })
      .where(eq(injectQueue.messageId, messageId)),
  );
  await nativeBatch(db, stmts);
  return { status: "ok", cardId, photoNo, serial };
}

export async function rejectQueued(
  db: Db,
  messageId: string,
  reviewerId: string,
  now: number,
): Promise<boolean> {
  const res = await nativeBatch(db, [
    db
      .update(injectQueue)
      .set({ status: "rejected", reviewedBy: reviewerId, reviewedAt: now })
      .where(
        and(
          eq(injectQueue.messageId, messageId),
          eq(injectQueue.status, "pending"),
        ),
      ),
  ]);
  return (res[0]?.meta.changes ?? 0) > 0;
}

/** A bulk batch = all pending rows sharing one source message (`-bN` suffix).
 * Single-photo messages never match: their ids carry no suffix. */
export interface BulkBatch {
  /** Original message id (prefix before `-bN`). */
  baseId: string;
  rows: QueueRow[];
}

/**
 * Oldest pending bulk batch: earliest `-bN` row defines the batch, all its
 * pending siblings come along. Returns null when no bulk row is pending.
 */
export async function oldestPendingBulkBatch(db: Db): Promise<BulkBatch | null> {
  const [first] = await db
    .select()
    .from(injectQueue)
    .where(
      and(
        eq(injectQueue.status, "pending"),
        QUEUE_POOL_NOT_HIDDEN_SQL,
        sql`${injectQueue.messageId} LIKE '%-b%'`,
      ),
    )
    .orderBy(asc(injectQueue.submittedAt))
    .limit(1);
  const head = (first as QueueRow | undefined) ?? null;
  if (head === null) return null;
  const dash = head.messageId.lastIndexOf("-b");
  if (dash < 0) return null;
  const baseId = head.messageId.slice(0, dash);
  const siblings = (await db
    .select()
    .from(injectQueue)
    .where(
      and(
        eq(injectQueue.status, "pending"),
        QUEUE_POOL_NOT_HIDDEN_SQL,
        sql`${injectQueue.messageId} LIKE ${baseId + "-b%"}`,
      ),
    )
    .orderBy(asc(injectQueue.messageId))) as QueueRow[];
  if (siblings.length === 0) return null;
  return { baseId, rows: siblings };
}

/** Distinct pending bulk batches (for the "N batch antre" counter). */
export async function countPendingBulkBatches(db: Db): Promise<number> {
  const rows = (await db
    .select({ messageId: injectQueue.messageId })
    .from(injectQueue)
    .where(
      and(
        eq(injectQueue.status, "pending"),
        QUEUE_POOL_NOT_HIDDEN_SQL,
        sql`${injectQueue.messageId} LIKE '%-b%'`,
      ),
    )) as Array<{ messageId: string }>;
  const bases = new Set<string>();
  for (const r of rows) {
    const dash = r.messageId.lastIndexOf("-b");
    if (dash > 0) bases.add(r.messageId.slice(0, dash));
  }
  return bases.size;
}

export interface BulkApproveOutcome {
  approved: Array<{ messageId: string; cardId: string }>;
  skipped: string[];
}

/**
 * All-or-nothing review of one bulk batch. Each row goes through the same
 * single-approve path (serial/photoNo assigned per row, atomic batch); rows
 * that fail (race, unknown group) are reported as skipped.
 */
export async function approveBulkBatch(
  db: Db,
  rows: QueueRow[],
  reviewerId: string,
  now: number,
): Promise<BulkApproveOutcome> {
  const approved: Array<{ messageId: string; cardId: string }> = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const outcome = await approveQueued(db, row.messageId, reviewerId, now);
    if (outcome.status === "ok") {
      approved.push({ messageId: row.messageId, cardId: outcome.cardId });
    } else {
      skipped.push(row.messageId);
    }
  }
  return { approved, skipped };
}

/** Reject every pending row of one bulk batch; returns rejected count. */
export async function rejectBulkBatch(
  db: Db,
  rows: QueueRow[],
  reviewerId: string,
  now: number,
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (await rejectQueued(db, row.messageId, reviewerId, now)) n += 1;
  }
  return n;
}
