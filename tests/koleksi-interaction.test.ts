import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import {
  handleHelp,
} from "../src/commands/help/handler.js";
import {
  handleKoleksi,
  handleKoleksiGrupAutocomplete,
  handleKoleksiPage,
} from "../src/commands/koleksi/handler.js";
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

function koleksiSlash(
  userId: string,
  opts: { pool?: string; grup?: string; publik?: boolean },
): APIChatInputApplicationCommandInteraction {
  const options: { name: string; type: number; value: string | boolean }[] = [];
  if (opts.pool !== undefined)
    options.push({ name: "pool", type: 3, value: opts.pool });
  if (opts.grup !== undefined)
    options.push({ name: "grup", type: 3, value: opts.grup });
  if (opts.publik !== undefined)
    options.push({ name: "publik", type: 5, value: opts.publik });
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: { id: "2", name: "koleksi", type: 1, options },
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

function helpSlash(userId: string): APIChatInputApplicationCommandInteraction {
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: { id: "2", name: "help", type: 1 },
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

function autocomplete(pool: string, typed: string) {
  return {
    type: InteractionType.ApplicationCommandAutocomplete,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "koleksi",
      type: 1,
      options: [
        { name: "pool", type: 3, value: pool, focused: false },
        { name: "grup", type: 3, value: typed, focused: true },
      ],
    },
    member: {
      user: { id: "u1", username: "u", discriminator: "0" },
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
  await db.insert(groups).values([
    { id: "g1", poolId: "pejabat", name: "Serie Satu", badge: "SATU", memberCount: 1, enabled: true },
    { id: "g2", poolId: "pejabat", name: "Serie Lain", badge: "LAIN", memberCount: 1, enabled: true },
  ]);
  await db.insert(members).values([
    { id: "anna", poolId: "pejabat", groupId: "g1", name: "Anna", nameLower: "anna", photoTotal: 1, sortOrder: 0, enabled: true },
    { id: "budi", poolId: "pejabat", groupId: "g2", name: "Budi", nameLower: "budi", photoTotal: 1, sortOrder: 1, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "anna-01", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 1, photoNo: 1, rarity: "common", imageFile: "a.webp", enabled: true },
    { id: "budi-01", poolId: "pejabat", groupId: "g2", memberId: "budi", serial: 2, photoNo: 1, rarity: "rare", imageFile: "b.webp", enabled: true },
  ]);
  await db.insert(users).values({ id: "u1", createdAt: 1 });
  await db.insert(userCards).values({
    userId: "u1",
    cardId: "anna-01",
    quantity: 1,
    firstObtainedAt: 1,
    lastObtainedAt: 1,
  });
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("handleKoleksiPage owner gate", () => {
  const stubEnv: Env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: null as never,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
  };

  it("rejects a non-owner ephemerally without touching waitUntil or DB", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleKoleksiPage(
      component("koleksi:p:999:pejabat:*:0", "111"),
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
    const { tasks, waitUntil } = captureTasks();
    const res = handleKoleksiPage(component("bogus", "111"), stubEnv, waitUntil);
    expect(tasks).toHaveLength(0);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    if (res.type !== InteractionResponseType.ChannelMessageWithSource) return;
    expect(res.data.content).toContain("kedaluwarsa");
  });

  it("defers the update for the owner and schedules the page task", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleKoleksiPage(
      component("koleksi:p:111:pejabat:*:0", "111"),
      stubEnv,
      waitUntil,
    );
    for (const t of tasks) t.catch(() => {});
    expect(res.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(tasks).toHaveLength(1);
  });
});

describe("handleKoleksi missing pool", () => {
  it("replies ephemerally without touching waitUntil", () => {
    const stubEnv: Env = {
      DISCORD_PUBLIC_KEY: "x",
      DB: null as never,
      PUBLIC_BASE_URL: "example.test",
      DISCORD_BOT_TOKEN: "token",
    };
    const { tasks, waitUntil } = captureTasks();
    const res = handleKoleksi(koleksiSlash("u1", {}), stubEnv, waitUntil);
    expect(tasks).toHaveLength(0);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });
});

describe("handleKoleksi followup prod replica", () => {
  it("renders prod-like multi-member multi-photo data", async () => {
    const db = createDb(env);
    // Mirror prod: menteri-angin (2 fotos) + wakil-dewan (1 foto).
    await db.insert(userCards).values({
      userId: "u1",
      cardId: "budi-01",
      quantity: 2,
      firstObtainedAt: 1,
      lastObtainedAt: 2,
    });
    const calls: { body: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleKoleksi(
        koleksiSlash("u1", { pool: "pejabat", publik: true }),
        env,
        waitUntil,
      );
      const settled = await Promise.allSettled(tasks);
      expect(
        settled.filter((r) => r.status === "rejected"),
      ).toHaveLength(0);
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as { embeds?: { description?: string }[] };
      expect(body.embeds?.[0]?.description).toContain("Anna");
      expect(body.embeds?.[0]?.description).toContain("Budi");
    } finally {
      vi.unstubAllGlobals();
      await db
        .delete(userCards)
        .where(eq(userCards.cardId, "budi-01"));
    }
  });
});

describe("handleKoleksi followup ok", () => {
  it("posts a public embed with nav row for an owned pool", async () => {
    const calls: { body: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleKoleksi(
        koleksiSlash("u1", { pool: "pejabat", publik: true }),
        env,
        waitUntil,
      );
      expect(res).toMatchObject({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as {
        embeds?: { title?: string; description?: string; footer?: { text?: string } }[];
        components?: { components?: { custom_id?: string; disabled?: boolean }[] }[];
        flags?: number;
      };
      expect(body.flags).toBeUndefined();
      expect(body.embeds?.[0]?.description).toContain("Anna");
      // Single page in fixture: no nav row (duplicate custom_ids).
      expect(body.components ?? []).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("handleKoleksi nav buttons", () => {
  it("omits nav on a single page (no duplicate custom_ids)", async () => {
    const calls: { body: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleKoleksi(koleksiSlash("u1", { pool: "pejabat" }), env, waitUntil);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as {
        components?: { components?: { custom_id?: string }[] }[];
      };
      expect(body.components ?? []).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("handleKoleksi nav multi-page", () => {
  it("shows prev/next with distinct custom_ids on two pages", async () => {
    const db = createDb(env);
    // 9 owned members in pejabat -> 2 pages (PAGE_SIZE 8).
    for (let i = 0; i < 9; i++) {
      const mid = `nav-m${i}`;
      await db.insert(members).values({
        id: mid,
        poolId: "pejabat",
        groupId: "g1",
        name: `Nav${i}`,
        nameLower: `nav${i}`,
        photoTotal: 1,
        sortOrder: 10 + i,
        enabled: true,
      });
      await db.insert(cards).values({
        id: `${mid}-01`,
        poolId: "pejabat",
        groupId: "g1",
        memberId: mid,
        serial: 100 + i,
        photoNo: 1,
        rarity: "common",
        imageFile: "n.webp",
        enabled: true,
      });
      await db.insert(userCards).values({
        userId: "u1",
        cardId: `${mid}-01`,
        quantity: 1,
        firstObtainedAt: 1,
        lastObtainedAt: 1,
      });
    }
    const calls: { body: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleKoleksi(koleksiSlash("u1", { pool: "pejabat" }), env, waitUntil);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as {
        components?: { components?: { custom_id?: string }[] }[];
      };
      const buttons = body.components?.[0]?.components ?? [];
      expect(buttons).toHaveLength(2);
      expect(buttons[0]?.custom_id).not.toBe(buttons[1]?.custom_id);
    } finally {
      vi.unstubAllGlobals();
      for (let i = 0; i < 9; i++) {
        await db.delete(userCards).where(eq(userCards.cardId, `nav-m${i}-01`));
        await db.delete(cards).where(eq(cards.id, `nav-m${i}-01`));
        await db.delete(members).where(eq(members.id, `nav-m${i}`));
      }
    }
  });
});

describe("handleKoleksi scope edge cases", () => {
  async function runKoleksi(
    userId: string,
    opts: { pool?: string; grup?: string },
  ): Promise<{ content: string; flags?: number }> {
    const calls: { body: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleKoleksi(koleksiSlash(userId, opts), env, waitUntil);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      const body = calls[0]?.body as { content?: string; flags?: number };
      return { content: body.content ?? "", flags: body.flags };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("replies unknown-pool for a missing pool", async () => {
    const out = await runKoleksi("u1", { pool: "no-such-pool" });
    expect(out.flags).toBe(64);
    expect(out.content).toContain("Pool tak dikenal");
  });

  it("replies unknown-group for a missing grup", async () => {
    const out = await runKoleksi("u1", { pool: "pejabat", grup: "no-such-group" });
    expect(out.flags).toBe(64);
    expect(out.content).toContain("sudah tidak ada / berubah");
  });

  it("replies empty when the user owns nothing in scope", async () => {
    const out = await runKoleksi("stranger", { pool: "pejabat" });
    expect(out.flags).toBe(64);
    expect(out.content).toContain("belum punya kartu");
  });
});

describe("handleKoleksiGrupAutocomplete", () => {
  it("suggests groups in the selected pool", async () => {
    const res = await handleKoleksiGrupAutocomplete(
      autocomplete("pejabat", "Ser"),
      env,
    );
    expect(res.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult
    )
      return;
    const choices = res.data.choices ?? [];
    expect(choices).toHaveLength(2);
    expect(choices.map((c) => c.value)).toContain("g1");
  });

  it("filters by the typed prefix", async () => {
    const res = await handleKoleksiGrupAutocomplete(
      autocomplete("pejabat", "Serie L"),
      env,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult
    )
      return;
    const choices = res.data.choices ?? [];
    expect(choices.map((c) => c.value)).toEqual(["g2"]);
  });
});

describe("handleHelp", () => {
  it("returns a public embed with the rate table and DB catalog", async () => {
    const res = await handleHelp(helpSlash("u1"), env);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    if (res.type !== InteractionResponseType.ChannelMessageWithSource) return;
    expect(res.data.flags).toBeUndefined();
    const embed = res.data.embeds?.[0];
    expect(embed?.description).toContain("48%");
    expect(embed?.description).toContain("★★★★");
    expect(embed?.description).toContain("★★★★★★");
    expect(embed?.description).toContain("Pejabat");
    expect(embed?.description).toContain("Serie Satu");
    expect(embed?.footer).toBeUndefined();
  });
});

describe("handleKoleksi followup", () => {
  it("POSTs an embed with a prev/next row", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleKoleksi(
        koleksiSlash("u1", { pool: "pejabat" }),
        env,
        waitUntil,
      );
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
        embeds?: { title?: string; footer?: { text?: string } }[];
        components?: { components?: { custom_id?: string; disabled?: boolean }[] }[];
        flags?: number;
      };
      expect(body.flags).toBe(64);
      expect(body.embeds?.[0]?.title).toContain("Koleksi");
      expect(body.embeds?.[0]?.footer?.text).toContain("1/1");
      // Single page: nav omitted instead of two disabled same-page buttons.
      expect(body.components ?? []).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
