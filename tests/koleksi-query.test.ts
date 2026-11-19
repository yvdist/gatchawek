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
import { getKoleksiPage, getHelpCatalog } from "../src/db/queries/koleksi.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;
let env: Env;

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
    memberCount: 3,
    enabled: true,
  });
  await db.insert(groups).values([
    { id: "g1", poolId: "pejabat", name: "Serie Satu", badge: "SATU", memberCount: 2, enabled: true },
    { id: "g2", poolId: "pejabat", name: "Serie Dua", badge: "DUA", memberCount: 1, enabled: true },
  ]);
  await db.insert(members).values([
    { id: "anna", poolId: "pejabat", groupId: "g1", name: "Anna", nameLower: "anna", photoTotal: 3, sortOrder: 0, enabled: true },
    { id: "budi", poolId: "pejabat", groupId: "g1", name: "Budi", nameLower: "budi", photoTotal: 1, sortOrder: 1, enabled: true },
    { id: "cici", poolId: "pejabat", groupId: "g2", name: "Cici", nameLower: "cici", photoTotal: 1, sortOrder: 2, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "anna-01", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 1, photoNo: 1, rarity: "common", imageFile: "a.webp", enabled: true },
    { id: "anna-02", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 2, photoNo: 2, rarity: "rare", imageFile: "b.webp", enabled: false },
    { id: "anna-03", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 3, photoNo: 3, rarity: "rare", imageFile: "c.webp", enabled: true },
    { id: "budi-01", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 4, photoNo: 1, rarity: "common", imageFile: "d.webp", enabled: true },
    { id: "cici-01", poolId: "pejabat", groupId: "g2", memberId: "cici", serial: 5, photoNo: 1, rarity: "common", imageFile: "e.webp", enabled: true },
  ]);
  await db.insert(users).values({ id: "u1", createdAt: 1 });
  await db.insert(userCards).values([
    { userId: "u1", cardId: "anna-01", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "anna-03", quantity: 2, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "anna-02", quantity: 5, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "budi-01", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
  await db.insert(users).values({ id: "u-empty", createdAt: 1 });
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("getKoleksiPage", () => {
  it("returns pool scope with 2 members and disabled card excluded", async () => {
    const outcome = await getKoleksiPage(
      db,
      "u1",
      { poolId: "pejabat", groupId: null },
      0,
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.members).toHaveLength(2);
    const anna = outcome.members.find((m) => m.memberId === "anna");
    expect(anna?.ownedPhotos).toBe(2);
    expect(anna?.photos).toEqual([
      { photoNo: 1, quantity: 1 },
      { photoNo: 3, quantity: 2 },
    ]);
    expect(outcome.totalPages).toBe(1);
    expect(outcome.page).toBe(0);
    expect(outcome.groupOwned).toBe(2);
    expect(outcome.groupTotal).toBe(3);
    expect(outcome.poolName).toBe("Pejabat");
    expect(outcome.groupName).toBeNull();
  });

  it("filters by group", async () => {
    const outcome = await getKoleksiPage(
      db,
      "u1",
      { poolId: "pejabat", groupId: "g2" },
      0,
    );
    expect(outcome).toEqual({ status: "empty" });
  });

  it("returns only group members when the user owns them", async () => {
    await db.insert(userCards).values({
      userId: "u1",
      cardId: "cici-01",
      quantity: 1,
      firstObtainedAt: 1,
      lastObtainedAt: 1,
    });
    const outcome = await getKoleksiPage(
      db,
      "u1",
      { poolId: "pejabat", groupId: "g2" },
      0,
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.members.map((m) => m.memberId)).toEqual(["cici"]);
    expect(outcome.groupOwned).toBe(1);
    expect(outcome.groupTotal).toBe(1);
    expect(outcome.groupName).toBe("Serie Dua");
  });

  it("clamps an over-range page to the last page", async () => {
    const outcome = await getKoleksiPage(
      db,
      "u1",
      { poolId: "pejabat", groupId: null },
      99,
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.page).toBe(outcome.totalPages - 1);
  });

  it("reports unknown pool and unknown group", async () => {
    await expect(
      getKoleksiPage(db, "u1", { poolId: "nope", groupId: null }, 0),
    ).resolves.toEqual({ status: "unknown-pool" });
    await expect(
      getKoleksiPage(db, "u1", { poolId: "pejabat", groupId: "nope" }, 0),
    ).resolves.toEqual({ status: "unknown-group" });
  });

  it("reports empty for a user with nothing in scope", async () => {
    await expect(
      getKoleksiPage(db, "u-empty", { poolId: "pejabat", groupId: null }, 0),
    ).resolves.toEqual({ status: "empty" });
  });
});

describe("getHelpCatalog", () => {
  it("lists pools and groups from the DB", async () => {
    const catalog = await getHelpCatalog(db);
    const pool = catalog.pools.find((p) => p.id === "pejabat");
    expect(pool?.name).toBe("Pejabat");
    expect(pool?.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });
});
