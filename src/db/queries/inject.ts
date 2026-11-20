import { and, asc, eq, sql } from "drizzle-orm";
import { cards, groups, injectQueue, members } from "../schema.js";
import { nativeBatch, type Db } from "../client.js";

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
  rarity: "common" | "rare" | "super_rare" | "ultra_rare" | null;
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
    .where(eq(injectQueue.status, "pending"))
    .orderBy(asc(injectQueue.submittedAt))
    .limit(1);
  return (row as QueueRow | undefined) ?? null;
}

export async function countPending(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(injectQueue)
    .where(eq(injectQueue.status, "pending"));
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
        rarity: (q.rarity ?? "common") as "common" | "rare" | "super_rare" | "ultra_rare",
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
