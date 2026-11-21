import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  userMeltPoints,
  userPoolStates,
  users,
} from "../src/db/schema.js";
import {
  MELT_POINTS_BY_RARITY,
  MELT_POINTS_PER_STAMINA,
  meltPointsForRarity,
  redeemableStamina,
  validateNewMelt,
  validateRedeem,
} from "../src/domain/melt.js";
import {
  dismantleCard,
  getMeltBalances,
  redeemPointsForStamina,
  searchMeltableCards,
} from "../src/db/queries/melt.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;
let env: Env;

async function quantityOf(userId: string, cardId: string): Promise<number> {
  const rows = await db
    .select({ quantity: userCards.quantity, userId: userCards.userId })
    .from(userCards)
    .where(eq(userCards.cardId, cardId));
  return rows.find((r) => r.userId === userId)?.quantity ?? 0;
}

async function pointsOf(userId: string, poolId: string): Promise<number> {
  const rows = await db
    .select({ points: userMeltPoints.points })
    .from(userMeltPoints)
    .where(
      and(
        eq(userMeltPoints.userId, userId),
        eq(userMeltPoints.poolId, poolId),
      ),
    );
  return rows[0]?.points ?? 0;
}

async function staminaOf(userId: string, poolId: string): Promise<number | null> {
  const rows = await db
    .select({ stamina: userPoolStates.stamina })
    .from(userPoolStates)
    .where(
      and(
        eq(userPoolStates.userId, userId),
        eq(userPoolStates.poolId, poolId),
      ),
    );
  return rows[0]?.stamina ?? null;
}

/** u1: rare-01 x3, common-01 x2, holo-01 x1, disabled-01 x2. */
async function resetInventory(): Promise<void> {
  await db.delete(userMeltPoints);
  await db.delete(userPoolStates);
  await db.delete(userCards);
  await db.delete(users);
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "rare-01", quantity: 3, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "common-01", quantity: 2, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "holo-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "disabled-01", quantity: 2, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
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
    memberCount: 1,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "g1",
    poolId: "pejabat",
    name: "Kabinet",
    badge: "KABINET",
    memberCount: 1,
    enabled: true,
  });
  await db.insert(members).values({
    id: "m-ani",
    poolId: "pejabat",
    groupId: "g1",
    name: "Ani",
    nameLower: "ani",
    photoTotal: 4,
    sortOrder: 0,
    enabled: true,
  });
  await db.insert(cards).values([
    { id: "rare-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 1, photoNo: 1, rarity: "rare", imageFile: "r1.webp", enabled: true },
    { id: "common-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 2, photoNo: 2, rarity: "common", imageFile: "c1.webp", enabled: true },
    { id: "holo-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 3, photoNo: 3, rarity: "holo", imageFile: "h1.webp", enabled: true },
    { id: "secret-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 4, photoNo: 4, rarity: "secret", imageFile: "s1.webp", enabled: true },
    { id: "disabled-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 5, photoNo: 5, rarity: "common", imageFile: "d1.webp", enabled: false },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("domain/melt", () => {
  it("prices every normal rarity from the single rate table", () => {
    expect(MELT_POINTS_BY_RARITY).toEqual({
      common: 5,
      rare: 10,
      super_rare: 20,
      ultra_rare: 40,
      holo: 0,
      secret: 0,
    });
    expect(MELT_POINTS_PER_STAMINA).toBe(100);
    expect(meltPointsForRarity("common")).toBe(5);
    expect(meltPointsForRarity("rare")).toBe(10);
    expect(meltPointsForRarity("super_rare")).toBe(20);
    expect(meltPointsForRarity("ultra_rare")).toBe(40);
  });

  it("never melts the last copy", () => {
    const base = { ownsCard: true, cardEnabled: true, rarity: "common" as const };
    expect(validateNewMelt({ ...base, quantity: 1 })).toBe("last-copy");
    expect(validateNewMelt({ ...base, quantity: 2 })).toBeNull();
    expect(validateNewMelt({ ...base, quantity: 0 })).toBe("card-not-owned");
    expect(validateNewMelt({ ...base, quantity: -1 })).toBe("card-not-owned");
    expect(validateNewMelt({ ...base, ownsCard: false, quantity: 5 })).toBe(
      "card-not-owned",
    );
  });

  it("rejects hidden rarities and disabled cards first", () => {
    expect(
      validateNewMelt({ ownsCard: true, quantity: 3, cardEnabled: true, rarity: "holo" }),
    ).toBe("card-hidden-rarity");
    expect(
      validateNewMelt({ ownsCard: true, quantity: 3, cardEnabled: true, rarity: "secret" }),
    ).toBe("card-hidden-rarity");
    expect(
      validateNewMelt({ ownsCard: true, quantity: 3, cardEnabled: true, rarity: null }),
    ).toBe("card-hidden-rarity");
    expect(
      validateNewMelt({ ownsCard: true, quantity: 3, cardEnabled: false, rarity: "rare" }),
    ).toBe("card-disabled");
  });

  it("converts points to whole stamina only", () => {
    expect(redeemableStamina(99)).toBe(0);
    expect(redeemableStamina(100)).toBe(1);
    expect(redeemableStamina(250)).toBe(2);
    expect(redeemableStamina(-50)).toBe(-1);
    expect(validateRedeem(50, true)).toBe("no-balance");
    expect(validateRedeem(100, true)).toBeNull();
    expect(validateRedeem(10_000, false)).toBe("pool-not-found");
  });
});

describe("melt queries", () => {
  beforeEach(resetInventory);

  it("offers only meltable duplicates in autocomplete", async () => {
    const choices = await searchMeltableCards(db, "u1", "");
    expect(choices.map((c) => c.id).sort()).toEqual(["common-01", "rare-01"]);
  });

  it("burns duplicates into pool-scoped points, never the last copy", async () => {
    const now = 1_000;
    const first = await dismantleCard(db, { userId: "u1", cardId: "rare-01", now });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.gained).toBe(10);
    expect(first.points).toBe(10);
    expect(await quantityOf("u1", "rare-01")).toBe(2);

    const second = await dismantleCard(db, { userId: "u1", cardId: "common-01", now });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.gained).toBe(5);
    expect(second.points).toBe(15);
    expect(await quantityOf("u1", "common-01")).toBe(1);

    // The common card is now down to its last copy: protected.
    const third = await dismantleCard(db, { userId: "u1", cardId: "common-01", now });
    expect(third).toEqual({ status: "rejected", reason: "last-copy" });
    expect(await quantityOf("u1", "common-01")).toBe(1);
    expect(await pointsOf("u1", "pejabat")).toBe(15);
  });

  it("rejects holo, disabled and unowned cards", async () => {
    const now = 1_000;
    expect(await dismantleCard(db, { userId: "u1", cardId: "holo-01", now })).toEqual({
      status: "rejected",
      reason: "card-hidden-rarity",
    });
    expect(
      await dismantleCard(db, { userId: "u1", cardId: "disabled-01", now }),
    ).toEqual({ status: "rejected", reason: "card-disabled" });
    expect(
      await dismantleCard(db, { userId: "u1", cardId: "secret-01", now }),
    ).toEqual({ status: "rejected", reason: "card-not-owned" });
  });

  it("lets exactly one of two parallel dismantles win at quantity 2", async () => {
    const outcomes = await Promise.all([
      dismantleCard(db, { userId: "u1", cardId: "common-01", now: 1_000 }),
      dismantleCard(db, { userId: "u1", cardId: "common-01", now: 1_000 }),
    ]);
    expect(outcomes.filter((o) => o.status === "ok")).toHaveLength(1);
    expect(await quantityOf("u1", "common-01")).toBe(1);
    expect(await pointsOf("u1", "pejabat")).toBe(5);
  });

  it("trades 250 points for +2 stamina, keeps 50", async () => {
    await db.insert(userMeltPoints).values({ userId: "u2", poolId: "pejabat", points: 250 });
    const outcome = await redeemPointsForStamina(db, {
      userId: "u2",
      poolId: "pejabat",
      now: 1_000,
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.stamina).toBe(2);
    expect(outcome.pointsLeft).toBe(50);
    expect(await staminaOf("u2", "pejabat")).toBe(12);
    expect(await pointsOf("u2", "pejabat")).toBe(50);
  });

  it("refuses redeem below 100 points without touching stamina", async () => {
    await db.insert(userMeltPoints).values({ userId: "u2", poolId: "pejabat", points: 50 });
    await db.insert(userPoolStates).values({
      userId: "u2",
      poolId: "pejabat",
      stamina: 3,
      staminaAnchorAt: 1_000,
      lastResetAt: null,
      version: 0,
      pityWish: 0,
    });
    const outcome = await redeemPointsForStamina(db, {
      userId: "u2",
      poolId: "pejabat",
      now: 1_000,
    });
    expect(outcome).toEqual({ status: "rejected", reason: "no-balance" });
    expect(await staminaOf("u2", "pejabat")).toBe(3);
    expect(await pointsOf("u2", "pejabat")).toBe(50);
  });

  it("exposes per-pool balances for /status", async () => {
    await dismantleCard(db, { userId: "u1", cardId: "rare-01", now: 1_000 });
    const balances = await getMeltBalances(db, "u1");
    expect(balances).toEqual([
      { poolId: "pejabat", poolName: "Pejabat", poolEmoji: "🏛️", points: 10 },
    ]);
    expect(await getMeltBalances(db, "u2")).toEqual([]);
  });
});
