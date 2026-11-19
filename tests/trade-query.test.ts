import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, nativeBatch, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import {
  acceptTrade,
  createTrade,
  getTradeById,
  resolveTrade,
  searchTradableCards,
} from "../src/db/queries/trade.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;
let env: Env;

async function seedInventory() {
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "anna-01", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "budi-01", quantity: 2, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  const d1 = await mf.getD1Database("DB");
  const dir = path.join(REPO_ROOT, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const content = await readFile(path.join(dir, file), "utf8");
    for (const chunk of content.split("--> statement-breakpoint")) {
      const stmt = chunk
        .trim()
        .replace(/`/g, '"')
        .replace(/;$/, "")
        .replace(/\s+/g, " ");
      if (stmt !== "") await d1.exec(stmt);
    }
  }
  env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: d1,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
  };
  db = createDb(env);

  await db.insert(pools).values({
    id: "pejabat",
    name: "Pejabat",
    emoji: "🏛️",
    staminaMax: 10,
    regenIntervalSec: 100,
    resetCooldownSec: 3600,
    memberCount: 2,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "g1",
    poolId: "pejabat",
    name: "Kabinet",
    badge: "KABINET",
    memberCount: 2,
    enabled: true,
  });
  await db.insert(members).values([
    { id: "anna", poolId: "pejabat", groupId: "g1", name: "Anna", nameLower: "anna", photoTotal: 1, sortOrder: 0, enabled: true },
    { id: "budi", poolId: "pejabat", groupId: "g1", name: "Budi", nameLower: "budi", photoTotal: 1, sortOrder: 1, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "anna-01", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 1, photoNo: 1, rarity: "rare", imageFile: "a.webp", enabled: true },
    { id: "budi-01", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 2, photoNo: 1, rarity: "common", imageFile: "b.webp", enabled: true },
    { id: "cici-01", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 3, photoNo: 2, rarity: "common", imageFile: "c.webp", enabled: false },
  ]);
  await seedInventory();
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

async function qty(userId: string, cardId: string): Promise<number | null> {
  const rows = await env.DB.prepare(
    "SELECT quantity FROM user_cards WHERE user_id = ?1 AND card_id = ?2",
  )
    .bind(userId, cardId)
    .all<{ quantity: number }>();
  return rows.results[0]?.quantity ?? null;
}

describe("createTrade", () => {
  it("creates a pending trade with 24h expiry", async () => {
    const now = 1_000_000;
    const outcome = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now,
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const row = await getTradeById(db, outcome.tradeId);
    expect(row?.status).toBe("pending");
    expect(row?.expiresAt).toBe(now + 86400);
  });

  it("rejects disabled cards", async () => {
    const outcome = await createTrade(db, {
      proposerId: "u2",
      targetId: "u1",
      targetIsBot: false,
      offerCardId: "budi-01",
      requestCardId: "cici-01",
      now: 2_000_000,
    });
    expect(outcome).toEqual({ status: "rejected", reason: "request-disabled" });
  });

  it("enforces 3 pending limit", async () => {
    for (let i = 0; i < 3; i++) {
      const o = await createTrade(db, {
        proposerId: "u2",
        targetId: "u1",
        targetIsBot: false,
        offerCardId: "budi-01",
        requestCardId: "anna-01",
        now: 3_000_000 + i,
      });
      expect(o.status).toBe("ok");
    }
    const fourth = await createTrade(db, {
      proposerId: "u2",
      targetId: "u1",
      targetIsBot: false,
      offerCardId: "budi-01",
      requestCardId: "anna-01",
      now: 3_000_003,
    });
    expect(fourth).toEqual({ status: "rejected", reason: "pending-limit" });
  });

  it("parallel double-submit past the limit lets exactly one win", async () => {
    await env.DB.prepare("DELETE FROM trades").run();
    // Seed 2 pending so both racers read pending=2 and pass the read batch.
    for (let i = 0; i < 2; i++) {
      const o = await createTrade(db, {
        proposerId: "u1",
        targetId: "u2",
        targetIsBot: false,
        offerCardId: "anna-01",
        requestCardId: "budi-01",
        now: 4_000_000 + i,
      });
      expect(o.status).toBe("ok");
    }
    const outs = await Promise.all([
      createTrade(db, {
        proposerId: "u1",
        targetId: "u2",
        targetIsBot: false,
        offerCardId: "anna-01",
        requestCardId: "budi-01",
        now: 4_000_010,
      }),
      createTrade(db, {
        proposerId: "u1",
        targetId: "u2",
        targetIsBot: false,
        offerCardId: "anna-01",
        requestCardId: "budi-01",
        now: 4_000_010,
      }),
    ]);
    const oks = outs.filter((o) => o.status === "ok");
    const denied = outs.filter((o) => o.status === "rejected");
    expect(oks).toHaveLength(1);
    expect(denied).toEqual([{ status: "rejected", reason: "pending-limit" }]);
  });
});

describe("acceptTrade", () => {
  it("swaps cards, increments existing, removes last row", async () => {
    await env.DB.prepare("DELETE FROM trades").run();
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',1,1,1), ('u2','anna-01',1,1,1), ('u2','budi-01',2,1,1)",
    ).run();
    const created = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now: 4_000_000,
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    const outcome = await acceptTrade(db, created.tradeId, 4_000_001);
    expect(outcome).toEqual({ status: "accepted" });
    // u1 gave last anna-01 away (row gone), received budi-01
    expect(await qty("u1", "anna-01")).toBeNull();
    expect(await qty("u1", "budi-01")).toBe(1);
    // u2 gave one budi-01, already had anna-01 -> quantity 2
    expect(await qty("u2", "anna-01")).toBe(2);
    expect(await qty("u2", "budi-01")).toBe(1);
  });

  it("double accept lets exactly one win", async () => {
    await env.DB.prepare("DELETE FROM trades").run();
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',1,1,1), ('u2','budi-01',1,1,1)",
    ).run();
    const created = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now: 5_000_000,
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    const [a, b] = await Promise.all([
      acceptTrade(db, created.tradeId, 5_000_001),
      acceptTrade(db, created.tradeId, 5_000_001),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["accepted", "already-resolved"]);
    expect(await qty("u1", "budi-01")).toBe(1);
    expect(await qty("u2", "anna-01")).toBe(1);
    expect(await qty("u1", "anna-01")).toBeNull();
    expect(await qty("u2", "budi-01")).toBeNull();
  });

  it("fails without mutation when offer is spent before accept", async () => {
    await env.DB.prepare("DELETE FROM trades").run();
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',1,1,1), ('u2','budi-01',1,1,1)",
    ).run();
    const created = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now: 6_000_000,
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    await env.DB.prepare(
      "UPDATE user_cards SET quantity = 0 WHERE user_id = 'u1' AND card_id = 'anna-01'",
    ).run();
    const outcome = await acceptTrade(db, created.tradeId, 6_000_001);
    expect(outcome).toEqual({ status: "ownership-changed" });
    const row = await getTradeById(db, created.tradeId);
    expect(row?.status).toBe("failed");
    expect(await qty("u2", "budi-01")).toBe(1);
  });

  it("rejects expired trades as failed", async () => {
    await env.DB.prepare("DELETE FROM trades").run();
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',1,1,1), ('u2','budi-01',1,1,1)",
    ).run();
    const now = 8_000_000;
    const created = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now,
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    const outcome = await acceptTrade(db, created.tradeId, now + 86401);
    expect(outcome).toEqual({ status: "expired" });
    expect((await getTradeById(db, created.tradeId))?.status).toBe("failed");
    expect(await qty("u1", "anna-01")).toBe(1);
    expect(await qty("u2", "budi-01")).toBe(1);
  });

  it("CHECK violation rolls back the whole batch", async () => {
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',3,1,1)",
    ).run();
    await expect(
      nativeBatch(db, [
        sql`UPDATE user_cards SET quantity = quantity - 5 WHERE user_id = 'u1' AND card_id = 'anna-01'`,
      ]),
    ).rejects.toThrow();
    expect(await qty("u1", "anna-01")).toBe(3);
  });
});

describe("resolveTrade", () => {
  it("declines and cancels, second call reports false", async () => {
    await env.DB.prepare("DELETE FROM trades").run();
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',1,1,1), ('u2','budi-01',1,1,1)",
    ).run();
    const a = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now: 7_000_000,
    });
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(await resolveTrade(db, a.tradeId, "declined", 7_000_001)).toBe(true);
    expect(await resolveTrade(db, a.tradeId, "declined", 7_000_002)).toBe(false);

    const b = await createTrade(db, {
      proposerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      offerCardId: "anna-01",
      requestCardId: "budi-01",
      now: 7_000_010,
    });
    expect(b.status).toBe("ok");
    if (b.status !== "ok") return;
    expect(await resolveTrade(db, b.tradeId, "cancelled", 7_000_011)).toBe(true);
  });
});

describe("searchTradableCards", () => {
  it("returns label with stars and sanitizes prefix", async () => {
    await env.DB.prepare("DELETE FROM user_cards").run();
    await env.DB.prepare(
      "INSERT INTO user_cards (user_id, card_id, quantity, first_obtained_at, last_obtained_at) VALUES ('u1','anna-01',1,1,1), ('u1','budi-01',1,1,1)",
    ).run();
    const all = await searchTradableCards(db, "u1", "");
    expect(all.length).toBe(2);
    const anna = all.find((c) => c.id === "anna-01");
    expect(anna?.label).toContain("Foto");
    expect(anna?.label).toContain("★★");
    expect(anna?.label.length).toBeLessThanOrEqual(100);
    const filtered = await searchTradableCards(db, "u1", "ann%_\\");
    expect(filtered.map((c) => c.id)).toEqual(["anna-01"]);
  });
});
