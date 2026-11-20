import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import {
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { groups, pools } from "../src/db/schema.js";
import {
  approveQueued,
  countPending,
  enqueueMessage,
  oldestPending,
  rejectQueued,
} from "../src/db/queries/inject.js";
import {
  handleInjectClick,
  handleInjectReview,
} from "../src/commands/inject-review/handler.js";
import {
  buildInjectReviewEmbed,
  parseInjectCustomId,
} from "../src/ui/injectReviewEmbed.js";
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
    data: { id: "2", name: "inject-review", type: 1 },
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

const QUEUE_ROW = {
  messageId: "m1",
  channelId: "c-inject",
  guildId: "g",
  authorId: "user1",
  submittedAt: 1000,
  messageUrl: "https://discord.com/channels/g/c-inject/m1",
  nama: "Tokoh Baru",
  memberId: "tokoh-baru",
  pool: "pejabat",
  grup: "kabinet-merah-putih",
  rarity: "rare" as const,
  label: null,
  sumber: "https://example.com/foto",
  imageUrl: "https://cdn.example.com/foto.png",
};

describe("inject queue", () => {
  it("enqueue is idempotent; oldestPending returns the earliest", async () => {
    const db = createDb(env);
    expect(await enqueueMessage(db, QUEUE_ROW)).toBe(true);
    expect(await enqueueMessage(db, QUEUE_ROW)).toBe(false);
    await enqueueMessage(db, { ...QUEUE_ROW, messageId: "m2", submittedAt: 2000 });
    const first = await oldestPending(db);
    expect(first?.messageId).toBe("m1");
    expect(await countPending(db)).toBe(2);
  });

  it("approve inserts member + card with next serial/photoNo atomically", async () => {
    const db = createDb(env);
    const outcome = await approveQueued(db, "m1", "boss", 3000);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.cardId).toBe("tokoh-baru-01");
    expect(outcome.photoNo).toBe(1);
    expect(outcome.serial).toBe(1);
    const first = await oldestPending(db);
    expect(first?.messageId).toBe("m2");
    const again = await approveQueued(db, "m1", "boss", 3000);
    expect(again.status).toBe("not-pending");
  });

  it("reject flips status; second reject reports false", async () => {
    const db = createDb(env);
    expect(await rejectQueued(db, "m2", "boss", 4000)).toBe(true);
    expect(await rejectQueued(db, "m2", "boss", 4000)).toBe(false);
    expect(await countPending(db)).toBe(0);
  });
});

describe("handleInjectReview", () => {
  it("rejects non-approvers", async () => {
    const res = await handleInjectReview(slash("random"), env);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("shows the oldest pending with photo and buttons", async () => {
    const db = createDb(env);
    await enqueueMessage(db, { ...QUEUE_ROW, messageId: "m3", submittedAt: 5000 });
    const res = await handleInjectReview(slash("boss"), env);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    if (res.type !== InteractionResponseType.ChannelMessageWithSource) return;
    const embed = res.data.embeds?.[0];
    expect(embed?.image?.url).toBe("https://cdn.example.com/foto.png");
    expect(embed?.description).toContain("Tokoh Baru");
    const buttons = res.data.components?.[0];
    expect(JSON.stringify(buttons)).toContain("inject:ok:m3");
    expect(JSON.stringify(buttons)).toContain("inject:no:m3");
    await rejectQueued(db, "m3", "boss", 6000);
  });

  it("says the queue is empty when nothing is pending", async () => {
    const res = await handleInjectReview(slash("boss"), env);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    if (res.type !== InteractionResponseType.ChannelMessageWithSource) return;
    expect(res.data.content).toContain("kosong");
  });
});

describe("handleInjectClick", () => {
  it("rejects non-approvers without touching the queue", async () => {
    const db = createDb(env);
    await enqueueMessage(db, { ...QUEUE_ROW, messageId: "m4", submittedAt: 7000 });
    const res = await handleInjectClick(click("inject:no:m4", "random"), env, () => {});
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(await countPending(db)).toBe(1);
    await rejectQueued(db, "m4", "boss", 8000);
  });

  it("approve click inserts the card via waitUntil", async () => {
    const db = createDb(env);
    await enqueueMessage(db, { ...QUEUE_ROW, messageId: "m5", submittedAt: 9000 });
    const { tasks, waitUntil } = captureTasks();
    const res = await handleInjectClick(click("inject:ok:m5", "boss"), env, waitUntil);
    expect(res.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource);
    const settled = await Promise.allSettled(tasks);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(await countPending(db)).toBe(0);
  });
});

describe("inject custom ids and embed", () => {
  it("parses ok/no ids and rejects junk", () => {
    expect(parseInjectCustomId("inject:ok:m1")).toEqual({ action: "ok", messageId: "m1" });
    expect(parseInjectCustomId("inject:no:m1")).toEqual({ action: "no", messageId: "m1" });
    expect(parseInjectCustomId("gacha:again:x")).toBeNull();
    expect(parseInjectCustomId("inject:maybe:m1")).toBeNull();
  });

  it("embed carries full photo and no internal URL", async () => {
    const db = createDb(env);
    await enqueueMessage(db, { ...QUEUE_ROW, messageId: "m6", submittedAt: 10000 });
    const row = await oldestPending(db);
    expect(row).not.toBeNull();
    if (row === null) return;
    const embed = buildInjectReviewEmbed({ row, pendingCount: 1 });
    expect(embed.image?.url).toBe("https://cdn.example.com/foto.png");
    const text = `${embed.title ?? ""}\n${embed.description ?? ""}`;
    expect(text).not.toContain("workers.dev");
    await rejectQueued(db, "m6", "boss", 11000);
  });
});
