import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import { getTopBoards } from "../src/db/queries/top.js";
import { handleTop } from "../src/commands/top/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let env: Env;
let db: Db;

function captureTasks(): { tasks: Promise<unknown>[]; waitUntil: WaitUntil } {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p) => void tasks.push(p) };
}

function topSlash(userId: string): APIChatInputApplicationCommandInteraction {
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: { id: "2", name: "top", type: 1, options: [] },
    member: {
      user: { id: userId, username: "u", discriminator: "0" },
      roles: [],
      premium_since: null,
      pending: false,
      permissions: "0",
      joined_at: "",
      flags: 0,
      mute: false,
      deaf: false,
    },
  } as unknown as APIChatInputApplicationCommandInteraction;
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
  await db.insert(groups).values([
    { id: "g1", poolId: "pejabat", name: "Kabinet", badge: "KABINET", memberCount: 2, enabled: true },
  ]);
  await db.insert(members).values([
    { id: "anna", poolId: "pejabat", groupId: "g1", name: "Anna", nameLower: "anna", photoTotal: 2, sortOrder: 0, enabled: true },
    { id: "budi", poolId: "pejabat", groupId: "g1", name: "Budi", nameLower: "budi", photoTotal: 1, sortOrder: 1, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "anna-01", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 1, photoNo: 1, rarity: "common", imageFile: "a1.webp", enabled: true },
    { id: "anna-02", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 2, photoNo: 2, rarity: "super_rare", holoEnabled: true, imageFile: "a2.webp", enabled: true },
    { id: "budi-01", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 3, photoNo: 1, rarity: "rare", imageFile: "b1.webp", enabled: true },
  ]);
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    // u1 owns both members (2 distinct), plus holo copies.
    { userId: "u1", cardId: "anna-01", quantity: 2, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "anna-02", quantity: 0, holoQty: 2, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "budi-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    // u2 owns one member, one holo copy.
    { userId: "u2", cardId: "budi-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "anna-02", quantity: 0, holoQty: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("getTopBoards", () => {
  it("ranks collectors by distinct members and holo owners by holo total", async () => {
    const boards = await getTopBoards(db);
    expect(boards.collectors[0]).toMatchObject({
      userId: "u1",
      distinctMembers: 2,
      rank: 1,
    });
    expect(boards.collectors[1]).toMatchObject({
      userId: "u2",
      distinctMembers: 2,
      rank: 2,
    });
    expect(boards.holoOwners[0]).toMatchObject({
      userId: "u1",
      holoTotal: 2,
      rank: 1,
    });
    expect(boards.holoOwners[1]).toMatchObject({
      userId: "u2",
      holoTotal: 1,
      rank: 2,
    });
  });
});

describe("/top", () => {
  it("defers and follows up with the leaderboard embed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleTop(topSlash("u1"), env, waitUntil);
      expect(res.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource);
      expect(tasks).toHaveLength(1);
      await tasks[0];
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      const body = JSON.parse(init.body) as {
        embeds: { title: string; description: string }[];
      };
      expect(body.embeds[0]?.title).toContain("Papan Peringkat");
      expect(body.embeds[0]?.description).toContain("<@u1>");
      expect(body.embeds[0]?.description).toContain("✦×2");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
