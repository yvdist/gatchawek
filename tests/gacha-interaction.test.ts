import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { createDb } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userPoolStates,
  users,
} from "../src/db/schema.js";
import { parseGachaAgainCustomId } from "../src/domain/gacha.js";
import {
  handleGacha,
  handleGachaAgain,
} from "../src/commands/gacha/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let env: Env;

function captureTasks(): { tasks: Promise<unknown>[]; waitUntil: WaitUntil } {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p) => void tasks.push(p) };
}

function component(
  customId: string,
  clickerId: string,
): APIMessageComponentInteraction {
  return {
    type: InteractionType.MessageComponent,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    app_permissions: "0",
    channel_id: "c",
    channel: { id: "c", type: 0 },
    data: { component_type: 2, custom_id: customId },
    member: {
      user: { id: clickerId, username: "u", discriminator: "0" },
      roles: [],
      premium_since: null,
      pending: false,
      permissions: "0",
      joined_at: "",
      flags: 0,
      mute: false,
      deaf: false,
    },
    message: {
      id: "m",
      type: 20,
      content: "",
      channel_id: "c",
      author: { id: "app", username: "b", discriminator: "0" },
      attachments: [],
      embeds: [],
      mentions: [],
      mention_roles: [],
      pinned: false,
      mention_everyone: false,
      tts: false,
      timestamp: "",
      edited_timestamp: null,
      flags: 0,
      components: [],
    },
  } as unknown as APIMessageComponentInteraction;
}

function slash(poolId: string, userId: string): APIChatInputApplicationCommandInteraction {
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "gacha",
      type: 1,
      options: [{ name: "pool", type: 3, value: poolId }],
    },
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
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
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
  const db = createDb(env);
  await db.insert(pools).values({
    id: "pejabat",
    name: "Pejabat",
    emoji: "🏛️",
    staminaMax: 5,
    regenIntervalSec: 100,
    resetCooldownSec: 3600,
    memberCount: 1,
  });
  await db.insert(groups).values({
    id: "g1",
    poolId: "pejabat",
    name: "Kabinet",
    badge: "KABINET",
    memberCount: 1,
  });
  await db
    .insert(members)
    .values({
      id: "aa",
      poolId: "pejabat",
      groupId: "g1",
      name: "Aa",
      nameLower: "aa",
      fullName: "Aa Full",
      photoTotal: 1,
    });
  await db.insert(cards).values({
    id: "aa-01",
    poolId: "pejabat",
    groupId: "g1",
    memberId: "aa",
    serial: 1,
    photoNo: 1,
    rarity: "common",
    imageFile: "aa-01.x.webp",
    enabled: true,
  });
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("parseGachaAgainCustomId", () => {
  it("accepts the canonical shape", () => {
    expect(parseGachaAgainCustomId("gacha:again:pejabat:123")).toEqual({
      poolId: "pejabat",
      ownerId: "123",
    });
  });

  it("rejects foreign namespaces, wrong actions, and short shapes", () => {
    expect(parseGachaAgainCustomId("koleksi:p:123:1")).toBeNull();
    expect(parseGachaAgainCustomId("gacha:reset:pejabat:123")).toBeNull();
    expect(parseGachaAgainCustomId("gacha:again:pejabat")).toBeNull();
    expect(parseGachaAgainCustomId("gacha:again::123")).toBeNull();
    expect(parseGachaAgainCustomId("gacha:again:pejabat:")).toBeNull();
    expect(parseGachaAgainCustomId("")).toBeNull();
  });
});

describe("handleGachaAgain owner gate", () => {
  const stubEnv: Env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: null as never,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
  };

  it("rejects a non-owner ephemerally without touching waitUntil or DB", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleGachaAgain(
      component("gacha:again:pejabat:999", "111"),
      stubEnv,
      waitUntil,
    );
    expect(tasks).toHaveLength(0);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    if (res.type !== InteractionResponseType.ChannelMessageWithSource) return;
    expect(res.data.flags).toBe(64);
    expect(res.data.content).toContain("999");
  });

  it("rejects a malformed custom id ephemerally", () => {
    const { waitUntil } = captureTasks();
    const res = handleGachaAgain(component("bogus", "111"), stubEnv, waitUntil);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("defers for the owner and schedules the pull task", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleGachaAgain(
      component("gacha:again:pejabat:111", "111"),
      stubEnv,
      waitUntil,
    );
    for (const t of tasks) t.catch(() => {});
    expect(res.type).toBe(
      InteractionResponseType.DeferredChannelMessageWithSource,
    );
    expect(tasks).toHaveLength(1);
  });
});

describe("handleGacha followup", () => {
  it("responds deferred immediately, then POSTs an embed + again button", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleGacha(slash("pejabat", "111"), env, waitUntil);
      expect(res).toEqual({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });
      expect(tasks).toHaveLength(1);
      await tasks[0];
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(calls[0]?.url).toBe(
        "https://discord.com/api/v10/webhooks/app/tok?wait=true",
      );
      const body = calls[0]?.body as {
        embeds?: { title?: string }[];
        components?: { components?: { custom_id?: string }[] }[];
      };
      expect(body.embeds?.[0]?.title).toContain("🎴");
      expect(
        body.components?.[0]?.components?.[0]?.custom_id,
      ).toBe("gacha:again:pejabat:111");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("handleGacha followup edge cases", () => {
  async function runFollowup(
    poolId: string,
    userId: string,
  ): Promise<{ calls: { url: string; body: unknown }[] }> {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleGacha(slash(poolId, userId), env, waitUntil);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      return { calls };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("replies Stamina habis with a relative timestamp when empty", async () => {
    const db = createDb(env);
    const now = Math.floor(Date.now() / 1000);
    await db.insert(users).values({ id: "g-empty", createdAt: now });
    await db.insert(userPoolStates).values({
      userId: "g-empty",
      poolId: "pejabat",
      stamina: 0,
      staminaAnchorAt: now,
      version: 0,
    });
    const { calls } = await runFollowup("pejabat", "g-empty");
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { content?: string; flags?: number };
    expect(body.flags).toBe(64);
    expect(body.content).toMatch(/Stamina habis\. Nambah lagi <t:\d+:R>\./);
  });

  it("replies pool-empty when the pool has no enabled cards", async () => {
    const { calls } = await runFollowup("no-such-pool", "111");
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { content?: string; flags?: number };
    expect(body.flags).toBe(64);
    expect(body.content).toContain("belum tersedia");
  });

  it("parallel Tarik Lagi taps settle exactly once", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const userId = "g-doubletap";
      const now = Math.floor(Date.now() / 1000);
      const db = createDb(env);
      await db.insert(users).values({ id: userId, createdAt: now });
      await db.insert(userPoolStates).values({
        userId,
        poolId: "pejabat",
        stamina: 1,
        staminaAnchorAt: now,
        version: 0,
      });
      const { tasks, waitUntil } = captureTasks();
      const r1 = handleGachaAgain(
        component("gacha:again:pejabat:" + userId, userId),
        env,
        waitUntil,
      );
      const r2 = handleGachaAgain(
        component("gacha:again:pejabat:" + userId, userId),
        env,
        waitUntil,
      );
      expect(r1.type).toBe(
        InteractionResponseType.DeferredChannelMessageWithSource,
      );
      expect(r2.type).toBe(
        InteractionResponseType.DeferredChannelMessageWithSource,
      );
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      const contents = calls.map(
        (c) => (c.body as { content?: string }).content ?? "",
      );
      const oks = contents.filter((c) => !c.includes("bentrok"));
      const conflicts = contents.filter((c) => c.includes("bentrok"));
      expect(oks).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
