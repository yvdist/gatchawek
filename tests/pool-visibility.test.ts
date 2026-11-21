import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  injectQueue,
  members,
  pools,
  userCards,
  users,
  wishes,
} from "../src/db/schema.js";
import {
  getPoolConfig,
  getUserStatusOverview,
} from "../src/db/queries/gacha.js";
import { getHelpCatalog, getKoleksiPage } from "../src/db/queries/koleksi.js";
import { getListPage, searchListPools } from "../src/db/queries/list.js";
import { searchAlbumPools } from "../src/db/queries/album.js";
import { getTopBoards } from "../src/db/queries/top.js";
import { getKartuProfileStats } from "../src/db/queries/kartu.js";
import { searchWishableCards, findWishableCard, listWishes } from "../src/db/queries/wish.js";
import { searchGiftableCards } from "../src/db/queries/give.js";
import { searchMeltableCards } from "../src/db/queries/melt.js";
import { searchShowcaseCards } from "../src/db/queries/pamer.js";
import { searchTradableCards } from "../src/db/queries/trade.js";
import { listTargetBattleCards } from "../src/db/queries/battle.js";
import { searchMembers } from "../src/db/queries/cari.js";
import { getShareableCard } from "../src/db/queries/share.js";
import { approveQueued } from "../src/db/queries/inject.js";
import {
  getAdminCard,
  getAdminCounts,
  listAdminCards,
  listAdminPools,
  listAdminPoolGroups,
  listAdminQueue,
} from "../src/db/queries/admin.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOW = 1_700_000_000;

let mf: Miniflare;
let db: Db;

const P = "pejabat";
const M = "meme";

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
  db = createDb({ DB: d1 } as never);

  await db.insert(pools).values([
    {
      id: P,
      name: "Pejabat",
      emoji: "🏛️",
      staminaMax: 10,
      regenIntervalSec: 1500,
      resetCooldownSec: 10800,
      memberCount: 1,
      enabled: true,
      hidden: true,
    },
    {
      id: M,
      name: "Jomok",
      emoji: "🐸",
      staminaMax: 10,
      regenIntervalSec: 1500,
      resetCooldownSec: 10800,
      memberCount: 1,
      enabled: true,
      hidden: false,
    },
  ]);
  await db.insert(groups).values([
    { id: "g-pejabat", poolId: P, name: "Grup Pejabat", badge: "GPJ", memberCount: 1, enabled: true },
    { id: "g-meme", poolId: M, name: "Grup Jomok", badge: "GJM", memberCount: 1, enabled: true },
  ]);
  await db.insert(members).values([
    {
      id: "pejabat-member",
      poolId: P,
      groupId: "g-pejabat",
      name: "Pejabat Satu",
      nameLower: "pejabat satu",
      photoTotal: 1,
      sortOrder: 0,
      enabled: true,
    },
    {
      id: "meme-member",
      poolId: M,
      groupId: "g-meme",
      name: "Jomok Satu",
      nameLower: "jomok satu",
      photoTotal: 1,
      sortOrder: 0,
      enabled: true,
    },
  ]);
  await db.insert(cards).values([
    {
      id: "pejabat-member-01",
      poolId: P,
      groupId: "g-pejabat",
      memberId: "pejabat-member",
      serial: 1,
      photoNo: 1,
      rarity: "common",
      holoEnabled: false,
      imageFile: "pejabat-member-01.aaaaaaaa.webp",
      sourcePageUrl: "https://example.test/pejabat",
      enabled: true,
    },
    {
      id: "meme-member-01",
      poolId: M,
      groupId: "g-meme",
      memberId: "meme-member",
      serial: 1,
      photoNo: 1,
      rarity: "common",
      holoEnabled: false,
      imageFile: "meme-member-01.bbbbbbbb.webp",
      sourcePageUrl: "https://example.test/meme",
      enabled: true,
    },
  ]);
  await db.insert(users).values({ id: "u1", exp: 0, createdAt: NOW });
  await db.insert(userCards).values([
    {
      userId: "u1",
      cardId: "pejabat-member-01",
      quantity: 2,
      holoQty: 0,
      firstObtainedAt: NOW,
      lastObtainedAt: NOW,
    },
    {
      userId: "u1",
      cardId: "meme-member-01",
      quantity: 2,
      holoQty: 0,
      firstObtainedAt: NOW,
      lastObtainedAt: NOW,
    },
  ]);
  await db.insert(wishes).values([
    { userId: "u1", poolId: P, cardId: "pejabat-member-01", createdAt: NOW },
    { userId: "u1", poolId: M, cardId: "meme-member-01", createdAt: NOW },
  ]);
  await db.insert(injectQueue).values([
    {
      messageId: "q-pejabat",
      channelId: "c1",
      guildId: "g1",
      submittedAt: NOW,
      messageUrl: "https://example.test/q-pejabat",
      nama: "Pejabat Baru",
      memberId: "pejabat-baru",
      pool: P,
      grup: "g-pejabat",
      rarity: "common",
      imageUrl: "https://example.test/new-pejabat.jpg",
      sumber: "https://example.test/src-pejabat",
      status: "pending",
    },
    {
      messageId: "q-meme",
      channelId: "c1",
      guildId: "g1",
      submittedAt: NOW,
      messageUrl: "https://example.test/q-meme",
      nama: "Jomok Baru",
      memberId: "meme-baru",
      pool: M,
      grup: "g-meme",
      rarity: "common",
      imageUrl: "https://example.test/new-meme.jpg",
      sumber: "https://example.test/src-meme",
      status: "pending",
    },
  ]);
});

afterAll(async () => {
  await mf.dispose();
});

describe("hidden pool is invisible to every bot read", () => {
  it("hides the pool config and pool-scoped pages", async () => {
    expect(await getPoolConfig(db, P)).toBeNull();
    expect(await getPoolConfig(db, M)).not.toBeNull();
    expect(await getKoleksiPage(db, "u1", { poolId: P, groupId: null }, 1)).toEqual({
      status: "unknown-pool",
    });
    expect(await getListPage(db, { poolId: P, groupId: null }, 1)).toEqual({
      status: "unknown-pool",
    });
    expect(await getListPage(db, { poolId: null, groupId: "g-pejabat" }, 1)).toEqual({
      status: "unknown-group",
    });
  });

  it("hides the pool from catalogs, boards and /status", async () => {
    const catalog = await getHelpCatalog(db);
    expect(catalog.pools.map((p) => p.id)).toEqual([M]);
    expect((await searchListPools(db, "")).map((p) => p.id)).toEqual([M]);
    expect((await searchAlbumPools(db, "")).map((p) => p.value)).toEqual([M]);
    const overview = await getUserStatusOverview(db, "u1", NOW);
    expect(overview.rows.map((r) => r.pool.id)).toEqual([M]);
    const top = await getTopBoards(db);
    expect(top.collectors.map((c) => c.poolId)).toEqual([M]);
  });

  it("hides its cards from every card-level surface", async () => {
    const memberIds = (await searchMembers(db, "", null)).map((m) => m.memberId);
    expect(memberIds).toEqual(["meme-member"]);
    expect((await searchGiftableCards(db, "u1", "")).map((c) => c.id)).toEqual([
      "meme-member-01",
    ]);
    expect((await searchMeltableCards(db, "u1", "")).map((c) => c.id)).toEqual([
      "meme-member-01",
    ]);
    expect((await searchShowcaseCards(db, "u1", "")).map((c) => c.id)).toEqual([
      "meme-member-01",
    ]);
    expect((await searchTradableCards(db, "u1", "")).map((c) => c.id)).toEqual([
      "meme-member-01",
    ]);
    expect((await searchWishableCards(db, "")).map((c) => c.cardId)).toEqual([
      "meme-member-01",
    ]);
    expect((await listTargetBattleCards(db, "u1")).map((c) => c.id)).toEqual([
      "meme-member-01",
    ]);
    expect(await findWishableCard(db, "pejabat-member-01")).toBeNull();
    expect((await listWishes(db, "u1")).map((c) => c.cardId)).toEqual([
      "meme-member-01",
    ]);
    expect(await getShareableCard(db, "pejabat-member-01")).toBeNull();
    expect(await getShareableCard(db, "meme-member-01")).not.toBeNull();
    const profile = await getKartuProfileStats(db, "u1");
    expect(profile.totalCards).toBe(2);
    expect(profile.uniqueMembers).toBe(1);
  });
});

describe("hidden pool is invisible to the admin panel and queue", () => {
  it("drops the pool, its groups and its cards", async () => {
    expect((await listAdminPools(db)).map((p) => p.poolId)).toEqual([M]);
    expect((await listAdminPoolGroups(db)).map((g) => g.poolId)).toEqual([M]);
    const cards = await listAdminCards(db, {
      kind: "all",
      q: "",
      limit: 50,
      offset: 0,
      poolId: P,
    });
    expect(cards.total).toBe(0);
    const counts = await getAdminCounts(db);
    expect(counts.total).toBe(1);
    expect(await getAdminCard(db, "pejabat-member-01")).toBeNull();
  });

  it("keeps queue rows for hidden pools out of the review list", async () => {
    const pending = await listAdminQueue(db, "pending", 50, 0);
    expect(pending.rows.map((r) => r.messageId)).toEqual(["q-meme"]);
    expect(pending.total).toBe(1);
    expect(await approveQueued(db, "q-pejabat", "u1", NOW)).toEqual({
      status: "unknown-pool",
    });
  });
});
