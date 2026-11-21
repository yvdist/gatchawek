import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
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
} from "../src/db/schema.js";
import {
  getAdminCard,
  getAdminCounts,
  importAdminCard,
  listAdminCards,
  listAdminPoolGroups,
  listAdminQueue,
  setAdminCardEnabled,
  setAdminCardImage,
  listRenderableCards,
  markRenderRequested,
  countAdminCardKinds,
  RENDER_PENDING_SEC,
} from "../src/db/queries/admin.js";
import { syncInjectChannel } from "../src/scheduled.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;

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
  const env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: d1,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
  } as unknown as Env;
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
  await db.insert(groups).values([
    { id: "g1", poolId: "pejabat", name: "Satu", badge: "SATU", memberCount: 1, enabled: true },
    { id: "g2", poolId: "pejabat", name: "Dua", badge: "DUA", memberCount: 1, enabled: true },
  ]);
  await db.insert(members).values([
    { id: "teddy", poolId: "pejabat", groupId: "g1", name: "Teddy", nameLower: "teddy", photoTotal: 3, sortOrder: 0, enabled: true },
    { id: "rapih", poolId: "pejabat", groupId: "g2", name: "Rapih Amat", nameLower: "rapih amat", photoTotal: 1, sortOrder: 1, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "teddy-01", poolId: "pejabat", groupId: "g1", memberId: "teddy", serial: 1, photoNo: 1, rarity: "ultra_rare", imageFile: "", enabled: true },
    { id: "teddy-02", poolId: "pejabat", groupId: "g1", memberId: "teddy", serial: 2, photoNo: 2, rarity: "rare", imageFile: "teddy.webp", enabled: true },
    { id: "rapih-01", poolId: "pejabat", groupId: "g2", memberId: "rapih", serial: 3, photoNo: 1, rarity: "common", imageFile: "https://cdn/x.png?ex=1", enabled: true },
    { id: "teddy-03", poolId: "pejabat", groupId: "g1", memberId: "teddy", serial: 4, photoNo: 3, rarity: "common", imageFile: "gone.webp", enabled: false },
  ]);
  await db.insert(users).values({ id: "u1", createdAt: 1 });
  await db.insert(userCards).values([
    { userId: "u1", cardId: "teddy-02", quantity: 2, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
  await db.insert(injectQueue).values([
    { messageId: "m1", channelId: "c", guildId: "g", submittedAt: 3, messageUrl: "https://x/3", status: "pending" },
    { messageId: "m2", channelId: "c", guildId: "g", submittedAt: 2, messageUrl: "https://x/2", status: "approved" },
    { messageId: "m3", channelId: "c", guildId: "g", submittedAt: 1, messageUrl: "https://x/1", status: "rejected" },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("listAdminCards", () => {
  it("filters empty images", async () => {
    const { rows, total } = await listAdminCards(db, { kind: "empty", q: "", limit: 50, offset: 0 });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(["teddy-01"]);
    expect(rows[0]?.imageKind).toBe("empty");
  });

  it("remote filter skips render-excluded pools (their raw photo is final)", async () => {
    const { total } = await listAdminCards(db, { kind: "remote", q: "", limit: 50, offset: 0 });
    expect(total).toBe(0);
  });

  it("todo filter lists cards still needing work, not excluded-pool photos", async () => {
    const { rows, total } = await listAdminCards(db, { kind: "todo", q: "", limit: 50, offset: 0 });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(["teddy-01"]);
  });

  it("marks render eligibility per row, excluding render-excluded pools", async () => {
    const { rows } = await listAdminCards(db, { kind: "all", q: "rapih", limit: 50, offset: 0 });
    // rapih-01 is remote + enabled but lives in the excluded pejabat pool.
    expect(rows[0]?.renderable).toBe(false);
  });

  it("done filter has rendered cards plus excluded-pool photos", async () => {
    const { rows, total } = await listAdminCards(db, { kind: "static", q: "", limit: 50, offset: 0 });
    expect(total).toBe(3);
    expect(rows.map((r) => r.id).sort()).toEqual(["rapih-01", "teddy-02", "teddy-03"]);
  });

  it("searches by member name prefix and card id", async () => {
    const byName = await listAdminCards(db, { kind: "all", q: "Ted", limit: 50, offset: 0 });
    expect(byName.total).toBe(3);
    const byId = await listAdminCards(db, { kind: "all", q: "rapih-01", limit: 50, offset: 0 });
    expect(byId.total).toBe(1);
    expect(byId.rows[0]?.id).toBe("rapih-01");
  });

  it("aggregates owned quantity and paginates", async () => {
    const page = await listAdminCards(db, { kind: "all", q: "", limit: 2, offset: 1 });
    expect(page.total).toBe(4);
    expect(page.rows).toHaveLength(2);
    expect(page.rows.map((r) => r.id)).toEqual(["teddy-01", "teddy-02"]);
    expect(page.rows[1]?.quantityOwned).toBe(2);
  });
});

describe("getAdminCard / setters", () => {
  it("returns null for unknown ids", async () => {
    await expect(getAdminCard(db, "nope-99")).resolves.toBeNull();
  });

  it("round-trips image and enabled", async () => {
    await expect(setAdminCardImage(db, "teddy-01", "https://cdn/new.png")).resolves.toBe(true);
    await expect(getAdminCard(db, "teddy-01")).resolves.toMatchObject({
      imageFile: "https://cdn/new.png",
      imageKind: "remote",
    });
    await expect(setAdminCardImage(db, "teddy-01", "")).resolves.toBe(true);
    await expect(setAdminCardEnabled(db, "teddy-03", true)).resolves.toBe(true);
    await expect(getAdminCard(db, "teddy-03")).resolves.toMatchObject({ enabled: true });
    await expect(setAdminCardEnabled(db, "nope-99", true)).resolves.toBe(false);
    await expect(setAdminCardImage(db, "nope-99", "x")).resolves.toBe(false);
  });
});

describe("listAdminQueue / getAdminCounts", () => {
  it("lists each status newest-first", async () => {
    await expect(listAdminQueue(db, "pending", 50, 0)).resolves.toMatchObject({ total: 1 });
    const approved = await listAdminQueue(db, "approved", 50, 0);
    expect(approved.rows[0]?.messageId).toBe("m2");
    const rejected = await listAdminQueue(db, "rejected", 50, 0);
    expect(rejected.rows[0]?.messageId).toBe("m3");
  });

  it("counts totals", async () => {
    await expect(getAdminCounts(db)).resolves.toMatchObject({
      total: 4,
      pending: 1,
    });
  });
});

describe("listAdminPoolGroups / importAdminCard", () => {
  it("lists active pool-group pairs", async () => {
    const pgs = await listAdminPoolGroups(db);
    expect(pgs).toHaveLength(2);
    expect(pgs.map((p) => `${p.poolId}:${p.groupId}`).sort()).toEqual([
      "pejabat:g1",
      "pejabat:g2",
    ]);
  });

  it("imports a new 5-star holo card directly to D1 and updates counts", async () => {
    const out1 = await importAdminCard(db, {
      poolId: "pejabat",
      groupId: "g1",
      nama: "Refi Kaget",
      rarity: "holo",
      label: null,
      imageUrl: "https://cdn.discordapp.com/attachments/1/2/refi.jpg",
      messageUrl: "https://discord.com/channels/g/c/m-refi-1",
      channelId: "c",
      guildId: "g",
      now: 1_700_000_000_000,
    });
    expect(out1).toEqual({
      status: "ok",
      cardId: "refi-kaget-01",
      memberId: "refi-kaget",
      nama: "Refi Kaget",
      rarity: "holo",
      photoNo: 1,
      serial: 5,
    });
    const detail1 = await getAdminCard(db, "refi-kaget-01");
    expect(detail1).toMatchObject({
      memberName: "Refi Kaget",
      rarity: "holo",
      holoEnabled: true,
      enabled: true,
      imageKind: "remote",
    });

    // Adding a second photo for the same member increments photoNo without duplicating member count.
    const out2 = await importAdminCard(db, {
      poolId: "pejabat",
      groupId: "g1",
      nama: "Refi Kaget",
      rarity: "rare",
      label: "Pose 2",
      imageUrl: "https://cdn.discordapp.com/attachments/1/2/refi2.jpg",
      messageUrl: "https://discord.com/channels/g/c/m-refi-2",
      channelId: "c",
      guildId: "g",
      now: 1_700_000_000_001,
    });
    expect(out2).toMatchObject({
      status: "ok",
      cardId: "refi-kaget-02",
      photoNo: 2,
      serial: 6,
    });
    const [grp] = await db.select().from(groups).where(eq(groups.id, "g1")).limit(1);
    const [pl] = await db.select().from(pools).where(eq(pools.id, "pejabat")).limit(1);
    expect(grp?.memberCount).toBe(2);
    expect(pl?.memberCount).toBe(3);

    const [audit] = await db
      .select()
      .from(injectQueue)
      .where(eq(injectQueue.memberId, "refi-kaget"))
      .limit(1);
    expect(audit?.status).toBe("approved");
    expect(audit?.messageId.startsWith("000000-gui-")).toBe(true);
    expect(audit?.messageUrl).toBe("https://discord.com/channels/g/c/m-refi-1");
    expect(audit?.sumber).toBe("https://cdn.discordapp.com/attachments/1/2/refi.jpg");
  });

  it("rejects unknown groups and member group mismatches", async () => {
    await expect(
      importAdminCard(db, {
        poolId: "pejabat",
        groupId: "missing",
        nama: "Test",
        rarity: "common",
        label: null,
        imageUrl: "https://cdn.discordapp.com/x.png",
        messageUrl: "https://discord.com/channels/g/c/m-missing",
        now: 100,
      }),
    ).resolves.toEqual({ status: "unknown-group" });

    await expect(
      importAdminCard(db, {
        poolId: "pejabat",
        groupId: "g2",
        nama: "Refi Kaget",
        rarity: "common",
        label: null,
        imageUrl: "https://cdn.discordapp.com/x.png",
        messageUrl: "https://discord.com/channels/g/c/m-mismatch",
        now: 101,
      }),
    ).resolves.toEqual({
      status: "member-group-mismatch",
      existingPoolId: "pejabat",
      existingGroupId: "g1",
    });
  });

  it("imports a secret card with holoEnabled and pool-scoped serial max+1", async () => {
    const before = await db.select().from(cards);
    const maxSerial = Math.max(0, ...before.filter((c) => c.poolId === "pejabat").map((c) => c.serial));
    const out = await importAdminCard(db, {
      poolId: "pejabat",
      groupId: "g2",
      nama: "Secret Star",
      rarity: "secret",
      label: null,
      imageUrl: "https://cdn.discordapp.com/attachments/1/2/secret.jpg",
      messageUrl: "https://discord.com/channels/g/c/m-secret-1",
      channelId: "c",
      guildId: "g",
      now: 1_700_000_000_020,
    });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.serial).toBe(maxSerial + 1);
    expect(out.photoNo).toBe(1);
    const detail = await getAdminCard(db, out.cardId);
    expect(detail).toMatchObject({ rarity: "secret", holoEnabled: true, enabled: true });
    const [audit] = await db
      .select()
      .from(injectQueue)
      .where(eq(injectQueue.memberId, out.memberId))
      .limit(1);
    expect(audit?.messageUrl).toBe("https://discord.com/channels/g/c/m-secret-1");
    expect(audit?.sumber).toBe("https://cdn.discordapp.com/attachments/1/2/secret.jpg");
  });

  it("gives distinct audit messageIds for two imports in the same millisecond", async () => {
    const now = 1_700_000_000_030;
    const [a, b] = await Promise.all([
      importAdminCard(db, {
        poolId: "pejabat",
        groupId: "g1",
        nama: "Twin A",
        rarity: "common",
        label: null,
        imageUrl: "https://cdn.discordapp.com/attachments/1/2/twin-a.jpg",
        messageUrl: "https://discord.com/channels/g/c/m-twin-a",
        channelId: "c",
        guildId: "g",
        now,
      }),
      importAdminCard(db, {
        poolId: "pejabat",
        groupId: "g1",
        nama: "Twin B",
        rarity: "common",
        label: null,
        imageUrl: "https://cdn.discordapp.com/attachments/1/2/twin-b.jpg",
        messageUrl: "https://discord.com/channels/g/c/m-twin-b",
        channelId: "c",
        guildId: "g",
        now,
      }),
    ]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(a.cardId).not.toBe(b.cardId);
    const rows = await db.select().from(injectQueue).where(eq(injectQueue.submittedAt, now));
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.messageId).sort();
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      expect(id.startsWith(`000000-gui-${String(now)}-`)).toBe(true);
    }
    expect(rows.map((r) => r.messageUrl).sort()).toEqual([
      "https://discord.com/channels/g/c/m-twin-a",
      "https://discord.com/channels/g/c/m-twin-b",
    ]);
  });

  it("keeps GUI audit rows out of the Discord sync cursor", async () => {
    const d1 = await mf.getD1Database("DB");
    await db.delete(injectQueue);
    await importAdminCard(db, {
      poolId: "pejabat",
      groupId: "g1",
      nama: "Cursor Guard",
      rarity: "holo",
      label: null,
      imageUrl: "https://cdn.discordapp.com/attachments/1/2/cg.jpg",
      messageUrl: "https://discord.com/channels/g/c/m-cursor",
      now: 1_700_000_000_010,
    });
    const seenUrls: string[] = [];
    const fetchMock = (async (input: unknown) => {
      seenUrls.push(String(input));
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const syncEnv = {
      DISCORD_PUBLIC_KEY: "x",
      DB: d1,
      PUBLIC_BASE_URL: "example.test",
      DISCORD_BOT_TOKEN: "token",
      INGEST_CHANNEL_ID: "c-inject",
      INGEST_GUILD_ID: "g",
      INJECT_APPROVER_IDS: "boss",
      ADMIN_PASSWORD: "pw",
      ADMIN_SECRET: "sec",
    } satisfies Env;
    await syncInjectChannel(syncEnv, fetchMock);
    expect(seenUrls[0]).toBe("https://discord.com/api/v10/channels/c-inject/messages?limit=100");
  });
});

describe("render requests", () => {
  beforeAll(async () => {
    await db.insert(pools).values({ id: "meme", name: "Jomok", emoji: "🐸", staminaMax: 10, regenIntervalSec: 100, resetCooldownSec: 3600, memberCount: 1, enabled: true });
    await db.insert(groups).values({ id: "jomok", poolId: "meme", name: "Jomok", badge: "JMK", memberCount: 1, enabled: true });
    await db.insert(members).values({ id: "ucup", poolId: "meme", groupId: "jomok", name: "Ucup", nameLower: "ucup", photoTotal: 1, sortOrder: 0, enabled: true });
    await db.insert(cards).values({ id: "ucup-01", poolId: "meme", groupId: "jomok", memberId: "ucup", serial: 1, photoNo: 1, rarity: "rare", imageFile: "https://cdn/u.png", enabled: true });
    await db.insert(members).values({ id: "abe", poolId: "meme", groupId: "jomok", name: "Abe", nameLower: "abe", photoTotal: 1, sortOrder: 1, enabled: true });
    await db.insert(cards).values({ id: "abe-01", poolId: "meme", groupId: "jomok", memberId: "abe", serial: 2, photoNo: 1, rarity: "common", imageFile: "https://cdn/a.png", enabled: true });
  });

  it("orders the todo queue: no image first, then raw", async () => {
    const { rows } = await listAdminCards(db, { kind: "todo", q: "", limit: 50, offset: 0 });
    expect(rows[0]?.id).toBe("teddy-01");
    expect(rows.map((r) => r.id)).toContain("abe-01");
  });

  it("counts every tab with the same search", async () => {
    const counts = await countAdminCardKinds(db, "");
    expect(counts.todo).toBeGreaterThanOrEqual(2);
    expect(counts.all).toBe(counts.empty + counts.remote + counts.static);
  });

  it("flags excluded-pool cards even when disabled", async () => {
    const { rows } = await listAdminCards(db, { kind: "all", q: "rapih", limit: 50, offset: 0 });
    expect(rows[0]?.excludedPool).toBe(true);
  });

  it("only accepts renderable cards and blocks repeats while a request is pending", async () => {
    const now = 1_000_000;
    await expect(listRenderableCards(db, ["ucup-01", "rapih-01"], now)).resolves.toEqual([
      { id: "ucup-01", imageFile: "https://cdn/u.png" },
    ]);
    await markRenderRequested(db, ["ucup-01"], now);
    await expect(listRenderableCards(db, ["ucup-01"], now + 60)).resolves.toEqual([]);
    await expect(
      listRenderableCards(db, ["ucup-01"], now + RENDER_PENDING_SEC + 1),
    ).resolves.toHaveLength(1);
  });

  it("counts stale render requests for the dashboard", async () => {
    await markRenderRequested(db, ["abe-01"], Math.floor(Date.now() / 1000) - RENDER_PENDING_SEC - 60);
    const counts = await getAdminCounts(db);
    // ucup-01 was stamped with a fixed old time by the previous test, abe-01 just now (past the window).
    expect(counts.renderStale).toBe(2);
  });

  it("flags a fresh request as pending on the list row", async () => {
    await markRenderRequested(db, ["ucup-01"], Math.floor(Date.now() / 1000));
    const { rows } = await listAdminCards(db, { kind: "remote", q: "ucup", limit: 50, offset: 0 });
    expect(rows[0]).toMatchObject({ id: "ucup-01", renderable: true, renderPending: true });
    expect(typeof rows[0]?.renderRequestedAt).toBe("number");
  });
});
