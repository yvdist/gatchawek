import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import { verifyBatchSupport } from "../src/db/queries/batch-check.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;

async function loadMigrationStatements(): Promise<string[]> {
  const dir = path.join(REPO_ROOT, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const parts: string[] = [];
  for (const file of files) {
    const content = await readFile(path.join(dir, file), "utf8");
    // drizzle-kit journal markers: split on statement breakpoints only.
    for (const chunk of content.split("--> statement-breakpoint")) {
      const trimmed = chunk
        .trim()
        .replace(/`/g, '"')
        .replace(/;$/, "")
        .replace(/\s+/g, " ");
      if (trimmed !== "") parts.push(trimmed);
    }
  }
  return parts;
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  // One shared D1 connection: miniflare isolates getD1Database handles.
  const d1 = await mf.getD1Database("DB");
  const statements = await loadMigrationStatements();
  for (const statement of statements) {
    await d1.exec(statement);
  }
  db = createDb({ DISCORD_PUBLIC_KEY: "x", DB: d1 });
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("db.batch with guarded raw statements", () => {
  it("verifyBatchSupport proves builder + raw batch together", async () => {
    await expect(verifyBatchSupport(db)).resolves.toBe(true);
  });

  it("atomic batch: builder insert + guarded update succeed together", async () => {
    const now = 1_700_000_000;
    // Setup rows sequentially (FK parents first).
    await db.insert(users).values({ id: "u1", createdAt: now });
    await db.insert(pools).values({ id: "pejabat", name: "P", emoji: "E" });
    await db.insert(groups).values({ id: "g", poolId: "pejabat", name: "G", badge: "G" });
    await db.insert(members).values({
      id: "m",
      poolId: "pejabat",
      groupId: "g",
      name: "M",
      nameLower: "m",
      photoTotal: 1,
    });
    await db.insert(cards).values({
      id: "m-01",
      poolId: "pejabat",
      groupId: "g",
      memberId: "m",
      serial: 1,
      photoNo: 1,
      rarity: "common",
      imageFile: "m-01.h.webp",
      sourcePageUrl: "https://example.com/x",
      enabled: true,
    });
    // The guarded pattern from spec §6.5: builder upsert plus a guard-checked
    // update in one atomic batch.
    await db.batch([
      db
        .insert(userCards)
        .values({
          userId: "u1",
          cardId: "m-01",
          quantity: 1,
          firstObtainedAt: now,
          lastObtainedAt: now,
        })
        .onConflictDoUpdate({
          target: [userCards.userId, userCards.cardId],
          set: { quantity: sql`excluded.quantity`, lastObtainedAt: now },
        }),
      db
        .update(userCards)
        .set({ quantity: sql`${userCards.quantity} + 1` })
        .where(
          sql`${userCards.userId} = 'u1' AND EXISTS (SELECT 1 FROM users WHERE id = 'u1')`,
        ),
    ]);
    const rows = await db.select().from(userCards);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.quantity).toBe(2);
  });

  it("CHECK violation rolls back the whole batch", async () => {
    const failing: Promise<unknown> = db.batch([
      db
        .insert(userCards)
        .values({
          userId: "u1",
          cardId: "m-01",
          quantity: 5,
          firstObtainedAt: 1,
          lastObtainedAt: 1,
        })
        .onConflictDoUpdate({
          target: [userCards.userId, userCards.cardId],
          set: { quantity: 5 },
        }),
      db
        .update(userCards)
        .set({ quantity: -1 })
        .where(sql`${userCards.userId} = 'u1'`),
    ]);
    await expect(failing).rejects.toThrow();
    const rows = await db.select().from(userCards);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.quantity).toBe(2);
  });
});
