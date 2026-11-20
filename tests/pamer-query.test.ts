import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
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
import {
  getShowcaseCard,
  searchShowcaseCards,
} from "../src/db/queries/pamer.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;
let env: Env;

const RARITY_ORDER = ["ultra_rare", "super_rare", "rare", "common"];

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

  await db.insert(pools).values([
    {
      id: "pejabat",
      name: "Pejabat",
      emoji: "🏛️",
      staminaMax: 10,
      regenIntervalSec: 100,
      resetCooldownSec: 3600,
      memberCount: 50,
      enabled: true,
    },
    {
      id: "kmp",
      name: "KMP",
      emoji: "🎭",
      staminaMax: 10,
      regenIntervalSec: 100,
      resetCooldownSec: 3600,
      memberCount: 50,
      enabled: true,
    },
  ]);
  await db.insert(groups).values([
    { id: "g1", poolId: "pejabat", name: "Serie Satu", badge: "SATU", memberCount: 10, enabled: true },
    { id: "g2", poolId: "kmp", name: "Kabinet", badge: "KBN", memberCount: 40, enabled: true },
  ]);
  await db.insert(members).values([
    { id: "anna", poolId: "pejabat", groupId: "g1", name: "Anna", nameLower: "anna", photoTotal: 2, sortOrder: 0, enabled: true },
    { id: "budi", poolId: "pejabat", groupId: "g1", name: "Budi", nameLower: "budi", photoTotal: 1, sortOrder: 1, enabled: true },
    { id: "zara", poolId: "kmp", groupId: "g2", name: "Zara", nameLower: "zara", photoTotal: 1, sortOrder: 0, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "ultra-1", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 1, photoNo: 1, rarity: "ultra_rare", imageFile: "u1.webp", enabled: true },
    { id: "super-1", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 2, photoNo: 2, rarity: "super_rare", imageFile: "s1.webp", enabled: true },
    { id: "rare-1", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 3, photoNo: 1, rarity: "rare", imageFile: "r1.webp", enabled: true },
    { id: "common-1", poolId: "kmp", groupId: "g2", memberId: "zara", serial: 4, photoNo: 1, rarity: "common", imageFile: "c1.webp", enabled: true },
    { id: "disabled-1", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 5, photoNo: 3, rarity: "ultra_rare", imageFile: "x.webp", enabled: false },
    { id: "other-1", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 6, photoNo: 2, rarity: "common", imageFile: "o.webp", enabled: true },
  ]);
  // 27 extra commons owned by u1 to exercise the LIMIT 25 cap.
  const extraMembers = Array.from({ length: 27 }, (_, i) => ({
    id: `mx${i}`,
    poolId: "kmp",
    groupId: "g2",
    name: `Mx${i}`,
    nameLower: `mx${i}`,
    photoTotal: 1,
    sortOrder: 10 + i,
    enabled: true,
  }));
  for (const m of extraMembers) {
    await db.insert(members).values(m);
  }
  for (const [i, m] of extraMembers.entries()) {
    await db.insert(cards).values({
      id: `mx-card-${i}`,
      poolId: "kmp",
      groupId: "g2",
      memberId: m.id,
      serial: 100 + i,
      photoNo: 1,
      rarity: "common" as const,
      imageFile: `mx${i}.webp`,
      enabled: true,
    });
  }
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "ultra-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "super-1", quantity: 2, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "rare-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "common-1", quantity: 5, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "disabled-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
  for (let i = 0; i < extraMembers.length; i++) {
    await db.insert(userCards).values({
      userId: "u1",
      cardId: `mx-card-${i}`,
      quantity: 1,
      firstObtainedAt: 1,
      lastObtainedAt: 1,
    });
  }
  await db.insert(userCards).values({
    userId: "u2",
    cardId: "other-1",
    quantity: 1,
    firstObtainedAt: 1,
    lastObtainedAt: 1,
  });
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("searchShowcaseCards", () => {
  it("orders owned cards ultra → super → rare → common, then name", async () => {
    const rows = await searchShowcaseCards(db, "u1", "");
    expect(rows.length).toBe(25);
    // Ultra/super/rare surface first in rank order despite the 25-cap.
    expect(rows[0]?.id).toBe("ultra-1");
    expect(rows[1]?.id).toBe("super-1");
    expect(rows[2]?.id).toBe("rare-1");
    expect(rows[0]?.label.startsWith("★★★★")).toBe(true);
  });

  it("narrows by member-name prefix and caps at 25 rows", async () => {
    const rows = await searchShowcaseCards(db, "u1", "an");
    expect(rows.map((r) => r.id).sort()).toEqual(["super-1", "ultra-1"]);
    const capped = await searchShowcaseCards(db, "u1", "");
    expect(capped).toHaveLength(25);
    expect(capped.every((r) => r.label.length <= 100)).toBe(true);
  });

  it("excludes disabled cards and other users' cards", async () => {
    const rows = await searchShowcaseCards(db, "u1", "");
    expect(rows.some((r) => r.id === "disabled-1")).toBe(false);
    expect(rows.some((r) => r.id === "other-1")).toBe(false);
    const other = await searchShowcaseCards(db, "u2", "");
    expect(other.map((r) => r.id)).toEqual(["other-1"]);
    void RARITY_ORDER;
  });
});

describe("getShowcaseCard", () => {
  it("returns the full display view for an owned card", async () => {
    const card = await getShowcaseCard(db, "u1", "ultra-1");
    expect(card).toMatchObject({
      id: "ultra-1",
      memberName: "Anna",
      photoNo: 1,
      photoTotal: 2,
      serial: 1,
      rarity: "ultra_rare",
      imageFile: "u1.webp",
      groupName: "Serie Satu",
      poolName: "Pejabat",
      quantity: 1,
    });
  });

  it("returns null for other owners, disabled cards, and unknown ids", async () => {
    await expect(getShowcaseCard(db, "u2", "ultra-1")).resolves.toBeNull();
    await expect(getShowcaseCard(db, "u1", "disabled-1")).resolves.toBeNull();
    await expect(getShowcaseCard(db, "u1", "nope")).resolves.toBeNull();
  });
});

describe("holo rarity in pamer", () => {
  it("ranks holo above ultra_rare and shows 5 stars", async () => {
    await db.insert(users).values({ id: "u-holo", createdAt: 1 });
    await db.insert(cards).values({
      id: "holo-1",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "anna",
      serial: 999,
      photoNo: 4,
      rarity: "holo",
      imageFile: "h1.webp",
      enabled: true,
    });
    await db.insert(userCards).values([
      { userId: "u-holo", cardId: "ultra-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
      { userId: "u-holo", cardId: "holo-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    ]);
    const rows = await searchShowcaseCards(db, "u-holo", "");
    expect(rows.map((r) => r.id)).toEqual(["holo-1", "ultra-1"]);
    expect(rows[0]?.label.startsWith("★★★★★")).toBe(true);
    const card = await getShowcaseCard(db, "u-holo", "holo-1");
    expect(card?.rarity).toBe("holo");
  });

  it("ranks secret above holo and shows 6 stars", async () => {
    await db.insert(users).values({ id: "u-secret", createdAt: 1 });
    await db.insert(cards).values({
      id: "secret-1",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "anna",
      serial: 1000,
      photoNo: 5,
      rarity: "secret",
      imageFile: "s1.webp",
      enabled: true,
    });
    await db.insert(userCards).values([
      { userId: "u-secret", cardId: "secret-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
      { userId: "u-secret", cardId: "holo-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
      { userId: "u-secret", cardId: "ultra-1", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    ]);
    const rows = await searchShowcaseCards(db, "u-secret", "");
    expect(rows.map((r) => r.id)).toEqual(["secret-1", "holo-1", "ultra-1"]);
    expect(rows[0]?.label.startsWith("★★★★★★")).toBe(true);
    const card = await getShowcaseCard(db, "u-secret", "secret-1");
    expect(card?.rarity).toBe("secret");
  });
});
