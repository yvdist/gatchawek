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
import {
  handleCari,
  handleCariAutocomplete,
} from "../src/commands/cari/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let env: Env;

function captureTasks(): { tasks: Promise<unknown>[]; waitUntil: WaitUntil } {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p) => void tasks.push(p) };
}

function cariSlash(
  userId: string,
  opts: { nama?: string; pool?: string },
): APIChatInputApplicationCommandInteraction {
  const options: { name: string; type: number; value: string }[] = [];
  if (opts.nama !== undefined)
    options.push({ name: "nama", type: 3, value: opts.nama });
  if (opts.pool !== undefined)
    options.push({ name: "pool", type: 3, value: opts.pool });
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: { id: "2", name: "cari", type: 1, options },
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

function cariAutocomplete(typed: string) {
  return {
    type: InteractionType.ApplicationCommandAutocomplete,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: {
      id: "2",
      name: "cari",
      type: 1,
      options: [{ name: "nama", type: 3, value: typed, focused: true }],
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
    { id: "g1", poolId: "pejabat", name: "Kabinet", badge: "KABINET", memberCount: 2, enabled: true },
  ]);
  await db.insert(members).values([
    { id: "anna", poolId: "pejabat", groupId: "g1", name: "Anna", nameLower: "anna", photoTotal: 2, sortOrder: 0, enabled: true },
    { id: "budi", poolId: "pejabat", groupId: "g1", name: "Budi", nameLower: "budi", photoTotal: 1, sortOrder: 1, enabled: true },
    { id: "katak", poolId: "pejabat", groupId: "g1", name: "Katak Bijak", nameLower: "katak bijak", photoTotal: 1, sortOrder: 2, enabled: true },
  ]);
  await db.insert(cards).values([
    { id: "anna-01", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 1, photoNo: 1, rarity: "common", imageFile: "a1.webp", enabled: true },
    { id: "anna-02", poolId: "pejabat", groupId: "g1", memberId: "anna", serial: 2, photoNo: 2, rarity: "super_rare", holoEnabled: true, imageFile: "a2.webp", enabled: true },
    { id: "budi-01", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 3, photoNo: 1, rarity: "rare", imageFile: "b1.webp", enabled: true },
    { id: "budi-02", poolId: "pejabat", groupId: "g1", memberId: "budi", serial: 5, photoNo: 2, rarity: "common", photoLabel: "Ryan Unjuk Kebolehan", imageFile: "b2.webp", enabled: true },
    { id: "katak-01", poolId: "pejabat", groupId: "g1", memberId: "katak", serial: 4, photoNo: 1, rarity: "common", imageFile: "k1.webp", enabled: true },
  ]);
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "anna-01", quantity: 2, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "anna-02", quantity: 0, holoQty: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "katak-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("/cari", () => {
  it("returns a deferred ack and follows up with owner mentions", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleCari(cariSlash("u1", { nama: "Anna" }), env, waitUntil);
      expect(res.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource);
      expect(tasks).toHaveLength(1);
      await tasks[0];
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      const body = JSON.parse(init.body) as {
        embeds: { title: string; description: string }[];
      };
      expect(body.embeds[0]?.title).toContain("Anna");
      // Owned card shows the owner mention with count.
      expect(body.embeds[0]?.description).toContain("<@u1>");
      // Holo copy shows ✦ marker.
      expect(body.embeds[0]?.description).toContain("✦×1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks cards nobody owns as free", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleCari(cariSlash("u1", { nama: "Budi" }), env, waitUntil);
      await tasks[0];
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      const body = JSON.parse(init.body) as {
        embeds: { description: string }[];
      };
      expect(body.embeds[0]?.description).toContain("Belum ada yang punya");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports unknown members", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleCari(cariSlash("u1", { nama: "Zzz" }), env, waitUntil);
      await tasks[0];
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      const body = JSON.parse(init.body) as {
        embeds: { description: string }[];
      };
      expect(body.embeds[0]?.description).toContain("Tidak ketemu");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("autocompletes member names capped at 25", async () => {
    const res = await handleCariAutocomplete(cariAutocomplete("a"), env);
    expect(res.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult
    )
      return;
    expect(res.data.choices?.length).toBeLessThanOrEqual(25);
    expect(res.data.choices?.length).toBeGreaterThan(0);
    expect(res.data.choices?.[0]?.name).toContain("Anna");
  });
  it("finds members by mid-word match (contains, not prefix)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleCari(cariSlash("u1", { nama: "tak" }), env, waitUntil);
      await tasks[0];
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      const body = JSON.parse(init.body) as {
        embeds: { title: string; description: string }[];
      };
      expect(body.embeds[0]?.title).toContain("tak");
      expect(body.embeds[0]?.description).toContain("Katak Bijak");
      expect(body.embeds[0]?.description).toContain("<@u1>");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("autocompletes mid-word matches", async () => {
    const res = await handleCariAutocomplete(cariAutocomplete("tak"), env);
    expect(res.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult
    )
      return;
    const names = (res.data.choices ?? []).map((c) => c.name);
    expect(names.some((n) => n.includes("Katak"))).toBe(true);
  });
  it("finds members by photo label and shows only the matching card", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      handleCari(cariSlash("u1", { nama: "ryan" }), env, waitUntil);
      await tasks[0];
      const [, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { body: string },
      ];
      const body = JSON.parse(init.body) as {
        embeds: { title: string; description: string }[];
      };
      expect(body.embeds[0]?.description).toContain("Budi");
      expect(body.embeds[0]?.description).toContain("Ryan Unjuk Kebolehan");
      // Strict: sibling non-matching cards of the label-hit member are hidden.
      expect(body.embeds[0]?.description).not.toContain("Foto 1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("autocompletes photo labels with owner member as value", async () => {
    const res = await handleCariAutocomplete(cariAutocomplete("ryan"), env);
    expect(res.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (
      res.type !== InteractionResponseType.ApplicationCommandAutocompleteResult
    )
      return;
    const choices = res.data.choices ?? [];
    const match = choices.find((c) => c.name.includes("Ryan Unjuk Kebolehan"));
    expect(match).toBeDefined();
    expect(match?.name).toContain("Budi");
    expect(match?.value).toBe("Budi");
  });
});
