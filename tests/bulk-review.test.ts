import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import {
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { groups, pools } from "../src/db/schema.js";
import {
  approveBulkBatch,
  countPending,
  countPendingBulkBatches,
  oldestPendingBulkBatch,
  enqueueMessage,
  rejectBulkBatch,
  rejectQueued,
} from "../src/db/queries/inject.js";
import {
  handleBulkClick,
  handleBulkReview,
} from "../src/commands/bulk-review/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let env: Env;

function slash(userId: string): APIChatInputApplicationCommandInteraction {
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    data: { id: "2", name: "bulk-review", type: 1 },
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

function click(
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

function captureTasks(): { tasks: Promise<unknown>[]; waitUntil: WaitUntil } {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p) => void tasks.push(p) };
}

const BASE_ROW = {
  channelId: "c-inject",
  guildId: "g",
  authorId: "user1",
  pool: "pejabat",
  grup: "kabinet-merah-putih",
  label: null,
  sumber: "https://example.com/foto",
  status: "pending" as const,
  errors: null,
};

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
    INGEST_CHANNEL_ID: "c-inject",
    INGEST_GUILD_ID: "g",
    INJECT_APPROVER_IDS: "boss",
  };
  const db = createDb(env);
  await db.insert(pools).values({
    id: "pejabat",
    name: "Pejabat",
    emoji: "🏛️",
    staminaMax: 10,
    regenIntervalSec: 100,
    resetCooldownSec: 3600,
    memberCount: 0,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "kabinet-merah-putih",
    poolId: "pejabat",
    name: "KMP",
    badge: "KABINET",
    memberCount: 0,
    enabled: true,
  });
}, 120_000);

afterAll(async () => {
  await mf.dispose();
});

describe("bulk batch queries", () => {
  it("groups -bN siblings into one batch, ignores single rows", async () => {
    const db = createDb(env);
    expect(
      await enqueueMessage(db, {
        ...BASE_ROW,
        messageId: "m-bulk-b1",
        submittedAt: 1000,
        messageUrl: "https://discord.com/channels/g/c-inject/m-bulk",
        nama: "Tokoh Satu",
        memberId: "tokoh-satu",
        rarity: "rare",
        imageUrl: "https://cdn.example.com/1.png",
      }),
    ).toBe(true);
    expect(
      await enqueueMessage(db, {
        ...BASE_ROW,
        messageId: "m-bulk-b2",
        submittedAt: 1001,
        messageUrl: "https://discord.com/channels/g/c-inject/m-bulk",
        nama: "Tokoh Dua",
        memberId: "tokoh-dua",
        rarity: "common",
        imageUrl: "https://cdn.example.com/2.png",
      }),
    ).toBe(true);
    expect(
      await enqueueMessage(db, {
        ...BASE_ROW,
        messageId: "m-single",
        submittedAt: 999,
        messageUrl: "https://discord.com/channels/g/c-inject/m-single",
        nama: "Solo",
        memberId: "solo",
        rarity: "rare",
        imageUrl: "https://cdn.example.com/s.png",
      }),
    ).toBe(true);
    const batch = await oldestPendingBulkBatch(db);
    expect(batch?.baseId).toBe("m-bulk");
    expect(batch?.rows.map((r) => r.messageId)).toEqual(["m-bulk-b1", "m-bulk-b2"]);
    expect(await countPendingBulkBatches(db)).toBe(1);
    expect(await countPending(db)).toBe(3);
  });

  it("approveBulkBatch approves every row with distinct card ids", async () => {
    const db = createDb(env);
    const batch = await oldestPendingBulkBatch(db);
    if (batch === null) throw new Error("expected a pending batch");
    const outcome = await approveBulkBatch(db, batch.rows, "boss", 3000);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.approved).toHaveLength(2);
    const ids = outcome.approved.map((a) => a.cardId).sort();
    expect(ids).toEqual(["tokoh-dua-01", "tokoh-satu-01"]);
    expect(await countPending(db)).toBe(1);
  });

  it("rejectBulkBatch rejects the whole batch at once", async () => {
    const db = createDb(env);
    expect(
      await enqueueMessage(db, {
        ...BASE_ROW,
        messageId: "m-bulk2-b1",
        submittedAt: 4000,
        messageUrl: "https://discord.com/channels/g/c-inject/m-bulk2",
        nama: "Tokoh Tiga",
        memberId: "tokoh-tiga",
        rarity: "rare",
        imageUrl: "https://cdn.example.com/3.png",
      }),
    ).toBe(true);
    expect(
      await enqueueMessage(db, {
        ...BASE_ROW,
        messageId: "m-bulk2-b2",
        submittedAt: 4001,
        messageUrl: "https://discord.com/channels/g/c-inject/m-bulk2",
        nama: "Tokoh Empat",
        memberId: "tokoh-empat",
        rarity: "common",
        imageUrl: "https://cdn.example.com/4.png",
      }),
    ).toBe(true);
    const batch = await oldestPendingBulkBatch(db);
    expect(batch?.baseId).toBe("m-bulk2");
    if (batch === null) throw new Error("expected a pending batch");
    expect(await rejectBulkBatch(db, batch.rows, "boss", 5000)).toBe(2);
  });
});

describe("handleBulkReview", () => {
  it("rejects non-approvers", async () => {
    const { waitUntil } = captureTasks();
    const res = await handleBulkReview(slash("random"), env, waitUntil);
    if (res.type !== 4 || res.data === undefined) throw new Error("expected channel message");
    expect(res.data.content).toContain("kurator");
  });

  it("shows the oldest batch with approve-all buttons", async () => {
    const db = createDb(env);
    expect(
      await enqueueMessage(db, {
        ...BASE_ROW,
        messageId: "m-bulk3-b1",
        submittedAt: 6000,
        messageUrl: "https://discord.com/channels/g/c-inject/m-bulk3",
        nama: "Tokoh Lima",
        memberId: "tokoh-lima",
        rarity: "rare",
        imageUrl: "https://cdn.example.com/5.png",
      }),
    ).toBe(true);
    const { tasks, waitUntil } = captureTasks();
    let patched: Record<string, unknown> | null = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PATCH") {
        patched = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({}));
      }
      // Sync sees no new messages: empty channel list.
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const res = await handleBulkReview(slash("boss"), env, waitUntil);
      expect(res.type).toBe(5);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      if (patched === null) throw new Error("expected patchOriginal call");
      const embeds = ((patched as Record<string, unknown>)["embeds"] ?? []) as Array<{ title?: string; description?: string }>;
      expect(embeds[0]?.title).toBe("📦 Review Bulk");
      expect(embeds[0]?.description).toContain("Tokoh Lima");
      const components = ((patched as Record<string, unknown>)["components"] ?? []) as Array<{
        components: Array<{ custom_id: string }>;
      }>;
      const ids = components[0]?.components.map((c) => c.custom_id) ?? [];
      expect(ids).toEqual(["bulk:ok:m-bulk3", "bulk:no:m-bulk3"]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("shows empty-queue notice when nothing pending", async () => {
    const db = createDb(env);
    // Drain oldest bulk leftovers first so the queue has no bulk batch left
    // (single-photo rows never match the bulk batch query).
    const leftover = await oldestPendingBulkBatch(db);
    if (leftover !== null) {
      expect(await rejectBulkBatch(db, leftover.rows, "boss", Date.now())).toBeGreaterThan(0);
    }
    expect(await countPendingBulkBatches(db)).toBe(0);
    const { tasks, waitUntil } = captureTasks();
    let patched: Record<string, unknown> | null = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PATCH") {
        patched = JSON.parse(String(init.body)) as Record<string, unknown>;
      }
      // Sync sees no new messages: empty channel list.
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      // Solo single-photo row is invisible to bulk review: batch query finds nothing.
      const res = await handleBulkReview(slash("boss"), env, waitUntil);
      expect(res.type).toBe(5);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      if (patched === null) throw new Error("expected patchOriginal call");
      const content = String((patched as Record<string, unknown>)["content"] ?? "");
      expect(content).toContain("kosong");
      expect(content).not.toContain("5 menit");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("approve-all click approves the whole batch", async () => {
    const db = createDb(env);
    const { tasks, waitUntil } = captureTasks();
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({}))) as typeof fetch;
    try {
      const out = await handleBulkClick(click("bulk:ok:m-bulk3", "boss"), env, waitUntil);
      expect(out.type).toBe(5);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      expect(await countPending(db)).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("syncs fresh channel messages on demand before showing the batch", async () => {
    const { tasks, waitUntil } = captureTasks();
    let patched: Record<string, unknown> | null = null;
    const origFetch = globalThis.fetch;
    const freshId = "m-fresh9";
    globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patched = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({}));
      }
      // Channel list: one fresh valid single-photo message after the cursor.
      if (url.includes("/channels/") && url.includes("/messages")) {
        return new Response(
          JSON.stringify([
            {
              id: freshId,
              content: "[nama] Pendatang Baru\n[pool] pejabat\n[grup] kabinet-merah-putih\n[rarity] common",
              timestamp: "2026-11-20T12:00:00.000Z",
              author: { id: "user9", bot: false },
              attachments: [
                {
                  url: "https://cdn.discordapp.net/attachments/1/9/foto.png",
                  filename: "foto.png",
                  content_type: "image/png",
                },
              ],
            },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}));
    }) as typeof fetch;
    try {
      // Single-photo row: invisible to bulk query, but must land in the queue.
      const res = await handleBulkReview(slash("boss"), env, waitUntil);
      expect(res.type).toBe(5);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      if (patched === null) throw new Error("expected patchOriginal call");
      const db = createDb(env);
      // reject hits only pending rows: proves the fresh message was enqueued
      // as pending by the on-demand sync (older leftovers aside).
      expect(await rejectQueued(db, freshId, "boss", Date.now())).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
