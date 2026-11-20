import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import {
  battles,
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import {
  createBattle,
  getBattleById,
  getPlayerBattleStats,
  listTargetBattleCards,
  resolveBattleCancelOrDecline,
  settleBattle,
} from "../src/db/queries/battle.js";
import {
  handleBattle,
  handleBattleAutocomplete,
  handleBattleComponent,
} from "../src/commands/battle/handler.js";
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

function slash(
  challengerId: string,
  targetId: string,
  cardId: string,
  mode?: "casual" | "wager",
): APIChatInputApplicationCommandInteraction {
  const options: { name: string; type: number; value: string }[] = [
    { name: "user", type: ApplicationCommandOptionType.User, value: targetId },
    { name: "card", type: ApplicationCommandOptionType.String, value: cardId },
  ];
  if (mode !== undefined) {
    options.push({
      name: "mode",
      type: ApplicationCommandOptionType.String,
      value: mode,
    });
  }
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "battle",
      type: 1,
      options,
      resolved: {
        users: {
          [targetId]: {
            id: targetId,
            username: "target",
            discriminator: "0",
            bot: false,
          },
        },
      },
    },
    member: {
      user: { id: challengerId, username: "challenger", discriminator: "0" },
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

function selectPick(
  customId: string,
  value: string,
  actorId: string,
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
    data: {
      component_type: ComponentType.StringSelect,
      custom_id: customId,
      values: [value],
    },
    member: {
      user: { id: actorId, username: "u", discriminator: "0" },
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

function buttonClick(
  customId: string,
  actorId: string,
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
    data: { component_type: ComponentType.Button, custom_id: customId },
    member: {
      user: { id: actorId, username: "u", discriminator: "0" },
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

function autocomplete(
  userId: string,
  typed: string,
): APIApplicationCommandAutocompleteInteraction {
  return {
    type: InteractionType.ApplicationCommandAutocomplete,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "battle",
      type: 1,
      options: [
        { name: "card", type: 3, value: typed, focused: true },
      ],
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
  } as unknown as APIApplicationCommandAutocompleteInteraction;
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
    INGEST_CHANNEL_ID: "c",
    INGEST_GUILD_ID: "g",
    INJECT_APPROVER_IDS: "boss",
    ADMIN_PASSWORD: "pw",
    ADMIN_SECRET: "sec",
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
    badge: "KMP",
    memberCount: 2,
    enabled: true,
  });
  await db.insert(members).values([
    {
      id: "budi",
      poolId: "pejabat",
      groupId: "g1",
      name: "Budi",
      nameLower: "budi",
      photoTotal: 2,
      sortOrder: 0,
      enabled: true,
    },
    {
      id: "ani",
      poolId: "pejabat",
      groupId: "g1",
      name: "Ani",
      nameLower: "ani",
      photoTotal: 2,
      sortOrder: 1,
      enabled: true,
    },
  ]);
  await db.insert(cards).values([
    {
      id: "budi-01",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "budi",
      serial: 1,
      photoNo: 1,
      rarity: "ultra_rare",
      imageFile: "budi-01.webp",
      enabled: true,
    },
    {
      id: "budi-02",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "budi",
      serial: 2,
      photoNo: 2,
      rarity: "common",
      imageFile: "budi-02.webp",
      enabled: true,
    },
    {
      id: "ani-01",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "ani",
      serial: 3,
      photoNo: 1,
      rarity: "rare",
      imageFile: "ani-01.webp",
      enabled: true,
    },
    {
      id: "ani-02",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "ani",
      serial: 4,
      photoNo: 2,
      rarity: "super_rare",
      imageFile: "ani-02.webp",
      enabled: true,
    },
    {
      id: "disabled-01",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "budi",
      serial: 5,
      photoNo: 3,
      rarity: "common",
      imageFile: "x.webp",
      enabled: false,
    },
  ]);
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
    { id: "u3", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "budi-01", quantity: 2, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "budi-02", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "ani-01", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "ani-02", quantity: 3, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("battle queries", () => {
  it("lists target cards ordered by highest rarity first", async () => {
    const opts = await listTargetBattleCards(db, "u2");
    expect(opts.map((o) => o.id)).toEqual(["ani-02", "ani-01"]);
    expect(opts[0]?.label).toContain("★★★ Ani (KMP)");
    expect(opts[0]?.description).toContain("Base 175 (+10 dup)");
  });

  it("enforces preconditions and 3-pending limit on createBattle", async () => {
    await expect(
      createBattle(db, {
        challengerId: "u1",
        targetId: "u2",
        targetIsBot: false,
        challengerCardId: "ani-01",
        mode: "casual",
        now: 1000,
      }),
    ).resolves.toEqual({ status: "rejected", reason: "card-not-owned" });

    await expect(
      createBattle(db, {
        challengerId: "u1",
        targetId: "u3",
        targetIsBot: false,
        challengerCardId: "budi-01",
        mode: "casual",
        now: 1000,
      }),
    ).resolves.toEqual({ status: "rejected", reason: "target-has-no-cards" });

    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const out = await createBattle(db, {
        challengerId: "u1",
        targetId: "u2",
        targetIsBot: false,
        challengerCardId: "budi-01",
        mode: "casual",
        now: 1000 + i,
      });
      expect(out.status).toBe("ok");
      if (out.status === "ok") created.push(out.battleId);
    }

    const fourth = await createBattle(db, {
      challengerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      challengerCardId: "budi-01",
      mode: "casual",
      now: 1010,
    });
    expect(fourth).toEqual({ status: "rejected", reason: "pending-limit" });

    for (const id of created) {
      await resolveBattleCancelOrDecline(db, id, "cancelled", 1020);
    }
  });

  it("settles casual battle without mutating userCards and tracks stats", async () => {
    const created = await createBattle(db, {
      challengerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      challengerCardId: "budi-01",
      mode: "casual",
      now: 2000,
    });
    if (created.status !== "ok") throw new Error("expected ok");

    // u1 (ultra_rare 220 + 5 dup + 50 rng = 275) vs u2 (rare 135 + 0 dup + 10 rng = 145)
    const rolls = [0.5, 0.5, 0.1, 0.5];
    let i = 0;
    const outcome = await settleBattle(db, {
      battleId: created.battleId,
      targetCardId: "ani-01",
      now: 2010,
      rand: () => rolls[i++] ?? 0,
    });
    expect(outcome.status).toBe("resolved");
    if (outcome.status !== "resolved") return;
    expect(outcome.calc.winnerId).toBe("u1");
    expect(outcome.winnerStats).toEqual({ wins: 1, losses: 0 });
    expect(await getPlayerBattleStats(db, "u2")).toEqual({ wins: 0, losses: 1 });

    const [u2Ani] = await db
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, "u2"), eq(userCards.cardId, "ani-01")));
    expect(u2Ani?.quantity).toBe(1);
  });

  it("settles wager battle atomically: transfers 1 copy and blocks double-settle race", async () => {
    const created = await createBattle(db, {
      challengerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      challengerCardId: "budi-01",
      mode: "wager",
      now: 3000,
    });
    if (created.status !== "ok") throw new Error("expected ok");

    const [a, b] = await Promise.all([
      settleBattle(db, {
        battleId: created.battleId,
        targetCardId: "ani-01",
        now: 3010,
        rand: () => 0.5,
      }),
      settleBattle(db, {
        battleId: created.battleId,
        targetCardId: "ani-01",
        now: 3011,
        rand: () => 0.5,
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["already-resolved", "resolved"]);

    // u2 lost their only ani-01 (row deleted); u1 gained 1x ani-01
    const [u2Ani] = await db
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, "u2"), eq(userCards.cardId, "ani-01")));
    expect(u2Ani).toBeUndefined();
    const [u1Ani] = await db
      .select()
      .from(userCards)
      .where(and(eq(userCards.userId, "u1"), eq(userCards.cardId, "ani-01")));
    expect(u1Ani?.quantity).toBe(1);

    // Restore ani-01 for u2 (remove from u1) for subsequent tests
    await db
      .delete(userCards)
      .where(and(eq(userCards.userId, "u1"), eq(userCards.cardId, "ani-01")));
    await db.insert(userCards).values({
      userId: "u2",
      cardId: "ani-01",
      quantity: 1,
      firstObtainedAt: 1,
      lastObtainedAt: 1,
    });
  });

  it("marks battle failed without card mutation when ownership is lost before pick", async () => {
    const created = await createBattle(db, {
      challengerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      challengerCardId: "budi-02",
      mode: "wager",
      now: 4000,
    });
    if (created.status !== "ok") throw new Error("expected ok");

    await db
      .delete(userCards)
      .where(and(eq(userCards.userId, "u1"), eq(userCards.cardId, "budi-02")));

    const outcome = await settleBattle(db, {
      battleId: created.battleId,
      targetCardId: "ani-01",
      now: 4010,
      rand: () => 0.5,
    });
    expect(outcome).toEqual({ status: "ownership-changed" });
    const row = await getBattleById(db, created.battleId);
    expect(row?.status).toBe("failed");

    await db.insert(userCards).values({
      userId: "u1",
      cardId: "budi-02",
      quantity: 1,
      firstObtainedAt: 1,
      lastObtainedAt: 1,
    });
  });
});

describe("battle interaction handlers", () => {
  it("handles /battle followup with blind-pick embed, third-party gate, and dropdown settle", async () => {
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(
      async (input: unknown, init?: { method?: string; body?: string }) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
        });
        return new Response("{}", { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleBattle(slash("u1", "u2", "budi-01", "casual"), env, waitUntil);
      expect(res.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource);
      await Promise.all(tasks);

      expect(calls).toHaveLength(1);
      const postedEmbed = ((calls[0]?.body["embeds"] ?? []) as Array<{ description?: string }>)[0];
      expect(postedEmbed?.description).toContain("Ultra Rare");
      expect(postedEmbed?.description).toContain("Identitas Kartu Rahasia");
      expect(postedEmbed?.description).not.toContain("Budi");

      const components = (calls[0]?.body["components"] ?? []) as Array<{
        components: Array<{ custom_id: string }>;
      }>;
      const selectCustomId = components[0]?.components[0]?.custom_id ?? "";
      expect(selectCustomId.startsWith("battle:pick:")).toBe(true);

      // Third-party actor gets ephemeral rejection without patching message
      const intrude = await handleBattleComponent(
        selectPick(selectCustomId, "ani-02", "u3"),
        env,
        waitUntil,
      );
      expect(intrude.type).toBe(InteractionResponseType.ChannelMessageWithSource);
      expect(calls).toHaveLength(1);

      // Target picks ani-02 -> battle settles via patchOriginal
      const pickTasks = captureTasks();
      const pickRes = await handleBattleComponent(
        selectPick(selectCustomId, "ani-02", "u2"),
        env,
        pickTasks.waitUntil,
        () => 0.5,
      );
      expect(pickRes.type).toBe(InteractionResponseType.DeferredMessageUpdate);
      await Promise.all(pickTasks.tasks);

      expect(calls).toHaveLength(2);
      expect(calls[1]?.method).toBe("PATCH");
      const resolvedEmbed = ((calls[1]?.body["embeds"] ?? []) as Array<{ description?: string }>)[0];
      expect(resolvedEmbed?.description).toContain("Budi");
      expect(resolvedEmbed?.description).toContain("Ani");
      expect(calls[1]?.body["components"]).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("handles cancel and decline buttons and autocomplete", async () => {
    const auto = await handleBattleAutocomplete(autocomplete("u1", "bu"), env);
    expect(auto.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (auto.type === InteractionResponseType.ApplicationCommandAutocompleteResult) {
      expect(auto.data.choices.map((c) => c.value)).toContain("budi-01");
    }

    const created = await createBattle(db, {
      challengerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      challengerCardId: "budi-01",
      mode: "casual",
      now: Math.floor(Date.now() / 1000),
    });
    if (created.status !== "ok") throw new Error("expected ok");

    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = await handleBattleComponent(
        buttonClick(`battle:decline:${created.battleId}`, "u2"),
        env,
        waitUntil,
      );
      expect(res.type).toBe(InteractionResponseType.DeferredMessageUpdate);
      await Promise.all(tasks);
      const [row] = await db
        .select()
        .from(battles)
        .where(eq(battles.id, created.battleId));
      expect(row?.status).toBe("declined");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
