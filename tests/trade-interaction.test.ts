import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { createDb } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import { buildTradeEmbed, tradeButtons } from "../src/ui/tradeEmbed.js";
import {
  handleTrade,
  handleTradeAutocomplete,
  handleTradeClick,
} from "../src/commands/trade/handler.js";
import { getTradeById } from "../src/db/queries/trade.js";
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

function slash(
  proposerId: string,
  targetId: string | null,
  offer: string | null,
  request: string | null,
  appId = "app",
  resolvedBot = false,
): APIChatInputApplicationCommandInteraction {
  const options: { name: string; type: number; value: string }[] = [];
  if (targetId !== null) {
    options.push({
      name: "user",
      type: ApplicationCommandOptionType.User,
      value: targetId,
    });
  }
  if (offer !== null) {
    options.push({ name: "offer", type: 3, value: offer });
  }
  if (request !== null) {
    options.push({ name: "request", type: 3, value: request });
  }
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: appId,
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "trade",
      type: 1,
      options,
      resolved:
        targetId === null
          ? undefined
          : {
              users: {
                [targetId]: {
                  id: targetId,
                  username: "t",
                  discriminator: "0",
                  bot: resolvedBot,
                },
              },
            },
    },
    member: {
      user: { id: proposerId, username: "u", discriminator: "0" },
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

function autocomplete(
  clickerId: string,
  focused: string,
  typed: string,
  targetId: string | null,
): APIApplicationCommandAutocompleteInteraction {
  return {
    type: InteractionType.ApplicationCommandAutocomplete,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "trade",
      type: 1,
      options: [
        ...(targetId === null
          ? []
          : [{ name: "user", type: 6, value: targetId }]),
        { name: focused, type: 3, value: typed, focused: true },
      ],
    },
    member: {
      user: { id: clickerId, username: "u", discriminator: "0" },
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
  };
  const db = createDb(env);
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
  ]);
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
    { id: "u3", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "anna-01", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "budi-01", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("handleTrade option gates", () => {
  it("rejects missing options and self/bot target without deferring", () => {
    const { tasks, waitUntil } = captureTasks();
    expect(
      handleTrade(slash("u1", null, "anna-01", "budi-01"), env, waitUntil),
    ).toMatchObject({ data: { flags: 64 } });
    expect(
      handleTrade(slash("u1", "u1", "anna-01", "budi-01"), env, waitUntil),
    ).toMatchObject({ data: { content: expect.stringMatching(/diri/) } });
    expect(
      handleTrade(slash("u1", "app", "anna-01", "budi-01", "app"), env, waitUntil),
    ).toMatchObject({ data: { content: expect.stringMatching(/bot/) } });
    expect(tasks).toHaveLength(0);
  });
});

describe("handleTradeClick gates", () => {
  it("rejects malformed custom id", async () => {
    const { waitUntil } = captureTasks();
    const res = await handleTradeClick(component("trade:hug:x", "u2"), env, waitUntil);
    expect(res).toMatchObject({ data: { content: "Tombol kedaluwarsa." } });
  });

  it("rejects a foreign bot target ephemerally", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleTrade(
      slash("u1", "bot-9", "anna-01", "budi-01", "app", true),
      env,
      waitUntil,
    );
    expect(tasks).toHaveLength(0);
    expect(res).toMatchObject({ data: { flags: 64 } });
    if (res.type !== InteractionResponseType.ChannelMessageWithSource) return;
    expect(res.data?.content).toMatch(/bot/i);
  });

  it("rejects third-party accept and target cancel without DB writes", async () => {
    const db = createDb(env);
    const { tasks, waitUntil } = captureTasks();
    const res = handleTrade(slash("u1", "u2", "anna-01", "budi-01"), env, waitUntil);
    expect(res).toMatchObject({ type: InteractionResponseType.DeferredChannelMessageWithSource });

    const post = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    try {
      await Promise.all(tasks);
    } finally {
      post.mockRestore();
    }
    const created = await env.DB.prepare(
      "SELECT id FROM trades WHERE proposer_id = 'u1' AND target_id = 'u2' AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    ).all<{ id: string }>();
    const tradeId = created.results[0]?.id;
    expect(tradeId).toBeTruthy();
    if (tradeId === undefined) return;

    const { tasks: acceptTasks, waitUntil: w2 } = captureTasks();
    // Outsider tries to accept: deferred task patches original, no state change.
    const patch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    let outsider;
    try {
      outsider = await handleTradeClick(
        component(`trade:accept:${tradeId}`, "u3"),
        env,
        w2,
      );
      await Promise.all(acceptTasks);
    } finally {
      patch.mockRestore();
    }
    expect(outsider).toMatchObject({ type: InteractionResponseType.DeferredMessageUpdate });
    expect((await getTradeById(db, tradeId))?.status).toBe("pending");

    // Target tries to cancel: not their button
    const wrongCancel = await handleTradeClick(
      component(`trade:cancel:${tradeId}`, "u2"),
      env,
      captureTasks().waitUntil,
    );
    expect(wrongCancel).toMatchObject({
      data: { content: "Tombol ini bukan untukmu." },
    });
    expect((await getTradeById(db, tradeId))?.status).toBe("pending");

    // Proposer cancels: type 6, result delivered via patchOriginal
    const { tasks: cancelTasks, waitUntil: w3 } = captureTasks();
    const cancelPatch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    let cancelled;
    try {
      cancelled = await handleTradeClick(
        component(`trade:cancel:${tradeId}`, "u1"),
        env,
        w3,
      );
      await Promise.all(cancelTasks);
    } finally {
      cancelPatch.mockRestore();
    }
    expect(cancelled).toMatchObject({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
    expect((await getTradeById(db, tradeId))?.status).toBe("cancelled");
  });

  it("delivers valid target decline via patchOriginal", async () => {
    const db = createDb(env);
    const { tasks, waitUntil } = captureTasks();
    handleTrade(slash("u1", "u2", "anna-01", "budi-01"), env, waitUntil);
    const post = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    try {
      await Promise.all(tasks);
    } finally {
      post.mockRestore();
    }
    const created = await env.DB.prepare(
      "SELECT id FROM trades WHERE proposer_id = 'u1' AND target_id = 'u2' AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    ).all<{ id: string }>();
    const tradeId = created.results[0]?.id;
    expect(tradeId).toBeTruthy();
    if (tradeId === undefined) return;

    const { tasks: declineTasks, waitUntil: w4 } = captureTasks();
    const declinePatch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "m" }), { status: 200 }));
    let declined;
    try {
      declined = await handleTradeClick(
        component(`trade:decline:${tradeId}`, "u2"),
        env,
        w4,
      );
      await Promise.all(declineTasks);
      expect(declinePatch).toHaveBeenCalled();
    } finally {
      declinePatch.mockRestore();
    }
    expect(declined).toMatchObject({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
    expect((await getTradeById(db, tradeId))?.status).toBe("declined");
  });

  it("accept on an unknown trade patches tidak tersedia", async () => {
    const { tasks, waitUntil } = captureTasks();
    const patch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    let res;
    try {
      res = await handleTradeClick(
        component("trade:accept:does-not-exist", "u2"),
        env,
        waitUntil,
      );
      await Promise.all(tasks);
      expect(patch).toHaveBeenCalled();
      const [, init] = patch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { content?: string };
      expect(body.content).toContain("tidak tersedia");
    } finally {
      patch.mockRestore();
    }
    expect(res).toMatchObject({
      type: InteractionResponseType.DeferredMessageUpdate,
    });
  });
});

describe("handleTradeAutocomplete", () => {
  it("suggests offer cards with stars and card id values", async () => {
    const res = await handleTradeAutocomplete(
      autocomplete("u1", "offer", "", null),
      env,
    );
    expect(res.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult ||
      res.data === undefined
    ) {
      return;
    }
    const choices = res.data.choices ?? [];
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0]?.name).toContain("Foto");
    expect(choices[0]?.name).toContain("★");
    expect(choices[0]?.value).toBe("anna-01");
  });

  it("returns empty choices when request target is missing", async () => {
    const res = await handleTradeAutocomplete(
      autocomplete("u1", "request", "", null),
      env,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult ||
      res.data === undefined
    ) {
      throw new Error("expected autocomplete result");
    }
    expect(res.data.choices).toEqual([]);
  });
});

describe("handleTrade followup posts public embed with three buttons", () => {
  it("posts without ephemeral flags", async () => {
    const { tasks, waitUntil } = captureTasks();
    await env.DB.prepare("DELETE FROM trades").run();
    const res = handleTrade(slash("u1", "u2", "anna-01", "budi-01"), env, waitUntil);
    expect(res).toMatchObject({ type: InteractionResponseType.DeferredChannelMessageWithSource });

    const post = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    try {
      await Promise.all(tasks);
      expect(post).toHaveBeenCalledTimes(1);
      const [, init] = post.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        flags?: number;
        components?: { components: { custom_id: string }[] }[];
      };
      expect(body.flags).toBeUndefined();
      expect(body.components?.[0]?.components).toHaveLength(3);
      expect(
        body.components?.[0]?.components.map((b) => b.custom_id),
      ).toEqual([
        expect.stringMatching(/^trade:accept:/),
        expect.stringMatching(/^trade:decline:/),
        expect.stringMatching(/^trade:cancel:/),
      ]);
    } finally {
      post.mockRestore();
    }
  });
});

describe("tradeButtons / buildTradeEmbed", () => {
  it("renders three buttons and pending mention", () => {
    const row = tradeButtons("tid-1");
    expect(row.components.map((b) => b.label)).toEqual([
      "✅ Terima",
      "❌ Tolak",
      "🚫 Batal",
    ]);
    const embed = buildTradeEmbed({
      proposerId: "u1",
      targetId: "u2",
      offer: { cardId: "anna-01", memberName: "Anna", groupBadge: "KABINET", photoNo: 1, rarity: "rare" },
      request: { cardId: "budi-01", memberName: "Budi", groupBadge: "KABINET", photoNo: 1, rarity: "common" },
      status: "pending",
      expiresAt: 999,
    });
    expect(embed.description).toContain("<@u1>");
    expect(embed.description).toContain("<@u2>");
    expect(embed.title).toBe("🔁 Tukar Kartu");
  });
});
