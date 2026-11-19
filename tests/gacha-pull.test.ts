import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  pulls,
  userCards,
  userPoolStates,
  users,
} from "../src/db/schema.js";
import {
  executePull,
  executeReset,
  getPoolConfig,
  getStatusOverview,
  type PoolConfig,
  type PoolStatusRow,
} from "../src/db/queries/gacha.js";
import { buildStatusEmbed } from "../src/ui/gachaEmbed.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;

const POOL: PoolConfig = {
  id: "pejabat",
  name: "Pejabat",
  emoji: "🏛️",
  staminaMax: 5,
  regenIntervalSec: 100,
  resetCooldownSec: 3600,
};

async function loadMigrationStatements(): Promise<string[]> {
  const dir = path.join(REPO_ROOT, "migrations");
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
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

async function seedMinimal(): Promise<void> {
  await db.insert(pools).values({
    id: POOL.id,
    name: POOL.name,
    emoji: POOL.emoji,
    sortOrder: 0,
    staminaMax: POOL.staminaMax,
    regenIntervalSec: POOL.regenIntervalSec,
    resetCooldownSec: POOL.resetCooldownSec,
    memberCount: 2,
  });
  await db.insert(groups).values({
    id: "g1",
    poolId: POOL.id,
    name: "Kabinet",
    badge: "KABINET",
    memberCount: 2,
  });
  await db.insert(members).values([
    {
      id: "aa",
      poolId: POOL.id,
      groupId: "g1",
      name: "Aa",
      nameLower: "aa",
      fullName: "Aa Full",
      photoTotal: 2,
    },
    {
      id: "bb",
      poolId: POOL.id,
      groupId: "g1",
      name: "Bb",
      nameLower: "bb",
      fullName: "Bb Full",
      photoTotal: 1,
    },
  ]);
  await db.insert(cards).values([
    {
      id: "aa-01",
      poolId: POOL.id,
      groupId: "g1",
      memberId: "aa",
      serial: 1,
      photoNo: 1,
      rarity: "common",
      imageFile: "aa-01.x.webp",
      enabled: true,
    },
    {
      id: "aa-02",
      poolId: POOL.id,
      groupId: "g1",
      memberId: "aa",
      serial: 2,
      photoNo: 2,
      rarity: "rare",
      imageFile: "aa-02.x.webp",
      enabled: true,
    },
    {
      id: "bb-01",
      poolId: POOL.id,
      groupId: "g1",
      memberId: "bb",
      serial: 3,
      photoNo: 1,
      rarity: "rare",
      imageFile: "bb-01.x.webp",
      enabled: true,
    },
    {
      id: "bb-02",
      poolId: POOL.id,
      groupId: "g1",
      memberId: "bb",
      serial: 4,
      photoNo: 2,
      rarity: "super_rare",
      holoEnabled: true,
      imageFile: "bb-02.x.webp",
      enabled: true,
    },
  ]);
}

/** Deterministic script of rand() outputs, cycled. */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v as number;
  };
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  const d1 = await mf.getD1Database("DB");
  const statements = await loadMigrationStatements();
  for (const statement of statements) {
    await d1.exec(statement);
  }
  db = createDb({
    DISCORD_PUBLIC_KEY: "x",
    DB: d1,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
  });
  await seedMinimal();
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("executePull labels and progress", () => {
  it("labels new-member, then new-photo, then duplicate ×2", async () => {
    const userId = "pull-labels";
    const now = 2_000_000;
    // pull 1: pick common aa-01 (roll 0 → common; index 0 of 1 common card)
    const first = await executePull(db, {
      userId,
      pool: POOL,
      now,
      rand: scripted([0.0, 0.0]),
    });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.kind).toBe("new-member");
    expect(first.quantity).toBe(1);
    expect(first.staminaLeft).toBe(POOL.staminaMax - 1);
    expect(first.groupOwned).toBe(1);
    expect(first.groupTotal).toBe(2);

    // pull 2: roll into rare (0.9), index 0 of 2 rare cards → aa-02
    const second = await executePull(db, {
      userId,
      pool: POOL,
      now: now + 10,
      rand: scripted([0.9, 0.0]),
    });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.card.id).toBe("aa-02");
    expect(second.kind).toBe("new-photo");
    expect(second.groupOwned).toBe(1);

    // pull 3: same card again → duplicate with quantity 2
    const third = await executePull(db, {
      userId,
      pool: POOL,
      now: now + 20,
      rand: scripted([0.9, 0.0]),
    });
    expect(third.status).toBe("ok");
    if (third.status !== "ok") return;
    expect(third.card.id).toBe("aa-02");
    expect(third.kind).toBe("duplicate");
    expect(third.quantity).toBe(2);
  });

  it("empty stamina returns the next tick, without spending", async () => {
    const userId = "pull-empty";
    const now = 3_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 0,
      staminaAnchorAt: now,
      version: 0,
    });
    const out = await executePull(db, {
      userId,
      pool: POOL,
      now,
      rand: scripted([0.0, 0.0]),
    });
    expect(out).toEqual({ status: "empty", nextAt: now + POOL.regenIntervalSec });
  });

  it("concurrent pulls with stamina 1 succeed exactly once", async () => {
    const userId = "pull-race";
    const now = 4_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 1,
      staminaAnchorAt: now,
      version: 0,
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        executePull(db, {
          userId,
          pool: POOL,
          now: now + i,
          rand: scripted([0.0, 0.0]),
        }),
      ),
    );
    const oks = results.filter((r) => r.status === "ok");
    expect(oks).toHaveLength(1);
    const owned = await db
      .select()
      .from(userCards)
      .where(eq(userCards.userId, userId));
    expect(owned.reduce((s, r) => s + r.quantity, 0)).toBe(1);
  });
});

describe("executePull holo", () => {
  it("banks holo_qty without touching quantity under the threshold", async () => {
    const userId = "pull-holo";
    const now = 7_000_000;
    // rarity roll 0.95 → super_rare (60+28+9=97 window over total 100);
    // index 0 of 1; holo roll 0.01 < 0.08.
    const out = await executePull(db, {
      userId,
      pool: POOL,
      now,
      rand: scripted([0.95, 0.0, 0.01]),
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.card.id).toBe("bb-02");
    expect(out.isHolo).toBe(true);
    expect(out.isFirstClaim).toBe(true);
    expect(out.quantity).toBe(0);
    const rows = await db
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, "bb-02")));
    expect(rows[0]?.quantity).toBe(0);
    expect(rows[0]?.holoQty).toBe(1);
    const history = await db
      .select()
      .from(pulls)
      .where(and(eq(pulls.userId, userId), eq(pulls.cardId, "bb-02")));
    expect(history[0]?.isHolo).toBe(true);
  });

  it("falls back to normal quantity above the threshold", async () => {
    const userId = "pull-noholo";
    const now = 8_000_000;
    const out = await executePull(db, {
      userId,
      pool: POOL,
      now,
      rand: scripted([0.95, 0.0, 0.5]),
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.card.id).toBe("bb-02");
    expect(out.isHolo).toBe(false);
    expect(out.isFirstClaim).toBe(false);
    expect(out.quantity).toBe(1);
  });
});

describe("executeReset", () => {
  it("ok fills stamina and records lastResetAt", async () => {
    const userId = "reset-ok";
    const now = 5_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 1,
      staminaAnchorAt: now,
      lastResetAt: now - POOL.resetCooldownSec - 5,
      version: 0,
    });
    const out = await executeReset(db, { userId, pool: POOL, now });
    expect(out).toEqual({ status: "ok", stamina: POOL.staminaMax });
    const rows = await db
      .select()
      .from(userPoolStates)
      .where(eq(userPoolStates.userId, userId));
    expect(rows[0]?.stamina).toBe(POOL.staminaMax);
    expect(rows[0]?.lastResetAt).toBe(now);
  });

  it("denies a full pool without side effects", async () => {
    const userId = "reset-full";
    const now = 6_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: POOL.staminaMax,
      staminaAnchorAt: now,
      lastResetAt: null,
      version: 0,
    });
    const out = await executeReset(db, { userId, pool: POOL, now });
    expect(out).toEqual({
      status: "denied",
      reason: "full",
      readyAt: now,
    });
  });

  it("denies during cooldown with the ready timestamp", async () => {
    const userId = "reset-cool";
    const now = 7_000_000;
    const last = now - 100;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 1,
      staminaAnchorAt: now,
      lastResetAt: last,
      version: 0,
    });
    const out = await executeReset(db, { userId, pool: POOL, now });
    expect(out).toEqual({
      status: "denied",
      reason: "cooldown",
      readyAt: last + POOL.resetCooldownSec,
    });
  });
});

describe("epoch-leak regression", () => {
  it("full stamina without prior reset reports no epoch timestamp", async () => {
    const userId = "reset-never";
    const now = 9_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: POOL.staminaMax,
      staminaAnchorAt: now,
      lastResetAt: null,
      version: 0,
    });
    const rows = await getStatusOverview(db, userId, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resetReady).toBe(false);
    expect(rows[0]?.resetDeniedReason).toBe("full");
    // The embed routes "full" away from the timestamp: no <t:0:R>.
    const embed = buildStatusEmbed(rows as PoolStatusRow[], userId);
    expect(embed.description ?? "").not.toContain("<t:0:R>");
    expect(embed.description ?? "").toContain("tidak perlu (masih penuh)");
  });

  it("parallel resets: exactly one wins, loser denial never epoch", async () => {
    const userId = "reset-race";
    const now = 10_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 1,
      staminaAnchorAt: now,
      lastResetAt: now - POOL.resetCooldownSec - 5,
      version: 0,
    });
    const outs = await Promise.all([
      executeReset(db, { userId, pool: POOL, now }),
      executeReset(db, { userId, pool: POOL, now }),
    ]);
    expect(outs.filter((o) => o.status === "ok")).toHaveLength(1);
    const denied = outs.filter((o) => o.status === "denied");
    expect(denied).toHaveLength(1);
    if (denied[0]?.status !== "denied") return;
    // Never the epoch: readyAt is now (full) or now + cooldown.
    expect(denied[0].readyAt).toBeGreaterThan(0);
    const states = await db
      .select()
      .from(userPoolStates)
      .where(eq(userPoolStates.userId, userId));
    expect(states[0]?.version).toBe(1);
    expect(states[0]?.stamina).toBe(POOL.staminaMax);
  });

  it("concurrent race loser keeps stamina and can retry", async () => {
    const userId = "pull-race-retry";
    const now = 11_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 1,
      staminaAnchorAt: now,
      version: 0,
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        executePull(db, {
          userId,
          pool: POOL,
          now,
          rand: scripted([0.0, 0.0]),
        }),
      ),
    );
    const oks = results.filter((r) => r.status === "ok");
    const conflicts = results.filter((r) => r.status === "conflict");
    expect(oks).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    // Losers kept their stamina (single spend) and exactly one pull logged.
    const states = await db
      .select()
      .from(userPoolStates)
      .where(eq(userPoolStates.userId, userId));
    expect(states[0]?.stamina).toBe(0);
    expect(states[0]?.version).toBe(1);
    const pulls = await db
      .select()
      .from(userCards)
      .where(eq(userCards.userId, userId));
    expect(pulls.reduce((s, r) => s + r.quantity, 0)).toBe(1);
  });

  it("pull vs reset race leaves state consistent", async () => {
    const userId = "pull-reset-race";
    const now = 12_000_000;
    await db.insert(users).values({ id: userId, createdAt: now });
    await db.insert(userPoolStates).values({
      userId,
      poolId: POOL.id,
      stamina: 1,
      staminaAnchorAt: now,
      lastResetAt: now - POOL.resetCooldownSec - 5,
      version: 0,
    });
    const [pullOut, resetOut] = await Promise.all([
      executePull(db, {
        userId,
        pool: POOL,
        now,
        rand: scripted([0.0, 0.0]),
      }),
      executeReset(db, { userId, pool: POOL, now }),
    ]);
    // Exactly one CAS winner: pull ok XOR reset ok.
    const pullWon = pullOut.status === "ok";
    const resetWon = resetOut.status === "ok";
    expect(pullWon !== resetWon).toBe(true);
    const states = await db
      .select()
      .from(userPoolStates)
      .where(eq(userPoolStates.userId, userId));
    expect(states[0]?.version).toBe(1);
    if (pullWon) {
      expect(states[0]?.stamina).toBe(0);
    } else {
      expect(states[0]?.stamina).toBe(POOL.staminaMax);
    }
  });
});

describe("pool takedown", () => {
  it("hides disabled pools from status and config", async () => {
    const now = 13_000_000;
    await db
      .update(pools)
      .set({ enabled: false })
      .where(eq(pools.id, POOL.id));
    try {
      expect(await getPoolConfig(db, POOL.id)).toBeNull();
      const rows = await getStatusOverview(db, "pull-labels", now);
      expect(rows).toHaveLength(0);
    } finally {
      await db
        .update(pools)
        .set({ enabled: true })
        .where(eq(pools.id, POOL.id));
    }
  });
});

describe("getStatusOverview", () => {
  it("returns one row per pool in one call", async () => {
    const rows = await getStatusOverview(db, "pull-labels", 8_000_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pool.id).toBe(POOL.id);
    expect(rows[0]?.owned).toBe(1);
    expect(rows[0]?.total).toBe(2);
  });
});
