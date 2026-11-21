import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  gives,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import {
  canClickGive,
  giveCustomId,
  isGiftableRarity,
  parseGiveCustomId,
  validateNewGive,
} from "../src/domain/give.js";
import {
  claimGive,
  createGive,
  getGiveById,
  resolveGive,
  searchGiftableCards,
} from "../src/db/queries/give.js";
import {
  handleGive,
  handleGiveClick,
  handleGiveTo,
} from "../src/commands/give/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;
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
      permissions: "0",
      joined_at: "",
      deaf: false,
      mute: false,
    },
  } as unknown as APIMessageComponentInteraction;
}

function giveSlash(
  userId: string,
  opts: { kartu?: string; user?: string; targetIsBot?: boolean },
): APIChatInputApplicationCommandInteraction {
  const options: { name: string; type: number; value: string }[] = [];
  if (opts.user !== undefined) {
    options.push({
      name: "user",
      type: ApplicationCommandOptionType.User,
      value: opts.user,
    });
  }
  if (opts.kartu !== undefined) {
    options.push({
      name: "kartu",
      type: ApplicationCommandOptionType.String,
      value: opts.kartu,
    });
  }
  const resolved =
    opts.user === undefined
      ? undefined
      : { users: { [opts.user]: { id: opts.user, bot: opts.targetIsBot === true } } };
  return {
    type: InteractionType.ApplicationCommand,
    id: "1",
    application_id: "app",
    token: "tok",
    version: 1,
    app_permissions: "0",
    channel_id: "c",
    channel: { id: "c", type: 0 },
    data: {
      id: "cmd-give",
      name: opts.user === undefined ? "give" : "give-to",
      type: 1,
      options,
      resolved,
    },
    member: {
      user: { id: userId, username: "u", discriminator: "0" },
      roles: [],
      permissions: "0",
      joined_at: "",
      deaf: false,
      mute: false,
    },
    guild_id: "g1",
    locale: "id",
    entitlements: [],
    authorizing_integration_owners: {},
  } as unknown as APIChatInputApplicationCommandInteraction;
}

/** u1 owns 1 copy of common-01, 1 holo-01 and 1 secret-01; u2 owns common-02. */
async function resetInventory(): Promise<void> {
  await db.delete(gives);
  await db.delete(userCards);
  await db.delete(users);
  await db.insert(users).values([
    { id: "u1", createdAt: 1 },
    { id: "u2", createdAt: 1 },
    { id: "u3", createdAt: 1 },
    { id: "u4", createdAt: 1 },
    { id: "u5", createdAt: 1 },
    { id: "u6", createdAt: 1 },
  ]);
  await db.insert(userCards).values([
    { userId: "u1", cardId: "common-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "holo-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u1", cardId: "secret-01", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
    { userId: "u2", cardId: "common-02", quantity: 1, holoQty: 0, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}

async function quantityOf(userId: string, cardId: string): Promise<number> {
  const rows = await db
    .select({ quantity: userCards.quantity, userId: userCards.userId })
    .from(userCards)
    .where(eq(userCards.cardId, cardId));
  return rows.find((r) => r.userId === userId)?.quantity ?? 0;
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
    memberCount: 1,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "g1",
    poolId: "pejabat",
    name: "Kabinet",
    badge: "KABINET",
    memberCount: 1,
    enabled: true,
  });
  await db.insert(members).values({
    id: "m-ani",
    poolId: "pejabat",
    groupId: "g1",
    name: "Ani",
    nameLower: "ani",
    photoTotal: 4,
    sortOrder: 0,
    enabled: true,
  });
  await db.insert(cards).values([
    { id: "common-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 1, photoNo: 1, rarity: "common", imageFile: "c1.webp", enabled: true },
    { id: "common-02", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 2, photoNo: 2, rarity: "rare", imageFile: "c2.webp", enabled: true },
    { id: "holo-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 3, photoNo: 3, rarity: "holo", imageFile: "c3.webp", enabled: true },
    { id: "secret-01", poolId: "pejabat", groupId: "g1", memberId: "m-ani", serial: 4, photoNo: 4, rarity: "secret", imageFile: "c4.webp", enabled: true },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("domain/give", () => {
  it("round-trips give custom ids", () => {
    const id = giveCustomId("claim", "abc-123");
    expect(id).toBe("give:claim:abc-123");
    expect(parseGiveCustomId(id)).toEqual({ action: "claim", giveId: "abc-123" });
  });

  it("rejects malformed give custom ids", () => {
    expect(parseGiveCustomId("give:claim:")).toBeNull();
    expect(parseGiveCustomId("trade:claim:x")).toBeNull();
    expect(parseGiveCustomId("give:bogus:x")).toBeNull();
    expect(parseGiveCustomId("give:claim:x:y")).toBeNull();
  });

  it("gates every give button to the right clicker", () => {
    expect(canClickGive("claim", "u2", "u1", null)).toBe(true);
    expect(canClickGive("claim", "u1", "u1", null)).toBe(false);
    expect(canClickGive("claim", null, "u1", null)).toBe(false);
    expect(canClickGive("accept", "u2", "u1", "u2")).toBe(true);
    expect(canClickGive("accept", "u3", "u1", "u2")).toBe(false);
    expect(canClickGive("accept", "u2", "u1", null)).toBe(false);
    expect(canClickGive("reject", "u2", "u1", "u2")).toBe(true);
    expect(canClickGive("reject", "u1", "u1", "u2")).toBe(false);
    expect(canClickGive("cancel", "u1", "u1", "u2")).toBe(true);
    expect(canClickGive("cancel", "u2", "u1", "u2")).toBe(false);
  });

  it("never gift holo or secret rarity", () => {
    expect(isGiftableRarity("holo")).toBe(false);
    expect(isGiftableRarity("secret")).toBe(false);
    expect(isGiftableRarity("common")).toBe(true);
    expect(isGiftableRarity("rare")).toBe(true);
    expect(isGiftableRarity("super_rare")).toBe(true);
    expect(isGiftableRarity("ultra_rare")).toBe(true);
    expect(
      validateNewGive({
        giverId: "u1",
        targetId: null,
        targetIsBot: false,
        ownsCard: true,
        cardEnabled: true,
        rarity: "holo",
      }),
    ).toBe("card-hidden-rarity");
  });
});

describe("give queries", () => {
  beforeEach(resetInventory);

  it("offers only visible, owned cards in autocomplete", async () => {
    const choices = await searchGiftableCards(db, "u1", "");
    expect(choices.map((c) => c.id)).toEqual(["common-01"]);
  });

  it("rejects holo, secret and unowned cards", async () => {
    const now = 1_000;
    const holo = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "holo-01", now });
    expect(holo).toEqual({ status: "rejected", reason: "card-hidden-rarity" });
    const secret = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "secret-01", now });
    expect(secret).toEqual({ status: "rejected", reason: "card-hidden-rarity" });
    const unowned = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "common-02", now });
    expect(unowned).toEqual({ status: "rejected", reason: "card-not-owned" });
  });

  it("lets exactly one of five parallel claimers win", async () => {
    const created = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "common-01", now: 1_000 });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;

    const outcomes = await Promise.all([
      claimGive(db, created.giveId, "u2", 1_001),
      claimGive(db, created.giveId, "u3", 1_001),
      claimGive(db, created.giveId, "u4", 1_001),
      claimGive(db, created.giveId, "u5", 1_001),
      claimGive(db, created.giveId, "u6", 1_001),
    ]);
    expect(outcomes.filter((o) => o.status === "claimed")).toHaveLength(1);

    const row = await getGiveById(db, created.giveId);
    expect(row?.status).toBe("claimed");
    // One copy moved: giver's row is gone, exactly one claimer holds it.
    expect(await quantityOf("u1", "common-01")).toBe(0);
    const holders = ["u2", "u3", "u4", "u5", "u6"];
    let copies = 0;
    for (const holder of holders) copies += await quantityOf(holder, "common-01");
    expect(copies).toBe(1);
  });

  it("keeps the card when the giveaway expired", async () => {
    const created = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "common-01", now: 1_000 });
    if (created.status !== "ok") throw new Error("expected ok");
    await db.update(gives).set({ expiresAt: 1_500 }).where(eq(gives.id, created.giveId));

    expect(await claimGive(db, created.giveId, "u2", 2_000)).toEqual({ status: "expired" });
    const row = await getGiveById(db, created.giveId);
    expect(row?.status).toBe("expired");
    expect(await quantityOf("u1", "common-01")).toBe(1);
    expect(await quantityOf("u2", "common-01")).toBe(0);
  });

  it("refuses a claim after the giver cancelled", async () => {
    const created = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "common-01", now: 1_000 });
    if (created.status !== "ok") throw new Error("expected ok");
    expect(await resolveGive(db, created.giveId, "cancelled", 1_001)).toBe(true);
    expect(await claimGive(db, created.giveId, "u2", 1_002)).toEqual({ status: "not-open" });
    expect(await quantityOf("u1", "common-01")).toBe(1);
  });

  it("keeps a direct give locked to its target", async () => {
    const created = await createGive(db, { mode: "direct", giverId: "u1", targetId: "u3", targetIsBot: false, cardId: "common-01", now: 1_000 });
    if (created.status !== "ok") throw new Error("expected ok");

    expect(await claimGive(db, created.giveId, "u2", 1_001)).toEqual({ status: "owner-lost" });
    expect(await quantityOf("u1", "common-01")).toBe(1);
    expect(await quantityOf("u2", "common-01")).toBe(0);

    expect(await claimGive(db, created.giveId, "u3", 1_002)).toEqual({ status: "not-open" });
  });

  it("fails the giveaway when the giver lost the card", async () => {
    const created = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "common-01", now: 1_000 });
    if (created.status !== "ok") throw new Error("expected ok");
    await db.delete(userCards).where(eq(userCards.cardId, "common-01"));

    expect(await claimGive(db, created.giveId, "u2", 1_001)).toEqual({ status: "owner-lost" });
    const row = await getGiveById(db, created.giveId);
    expect(row?.status).toBe("failed");
    expect(await quantityOf("u2", "common-01")).toBe(0);
  });
});

describe("give handlers", () => {
  beforeEach(resetInventory);

  it("asks for a card pick without touching waitUntil", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleGive(giveSlash("u1", {}), env, waitUntil);
    expect(tasks).toHaveLength(0);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("rejects a bot target synchronously in give-to", () => {
    const { tasks, waitUntil } = captureTasks();
    const res = handleGiveTo(
      giveSlash("u1", { kartu: "common-01", user: "bot1", targetIsBot: true }),
      env,
      waitUntil,
    );
    expect(tasks).toHaveLength(0);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  });

  it("posts a public giveaway with claim and cancel buttons", async () => {
    const calls: { body: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleGive(giveSlash("u1", { kartu: "common-01" }), env, waitUntil);
      expect(res.type).toBe(
        InteractionResponseType.DeferredChannelMessageWithSource,
      );
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as {
        flags?: number;
        embeds?: { title?: string; description?: string; thumbnail?: { url?: string } }[];
        components?: { components?: { custom_id?: string }[] }[];
      };
      expect(body.flags).toBeUndefined();
      expect(body.embeds?.[0]?.title).toContain("Giveaway");
      expect(body.embeds?.[0]?.description).toContain("siapa cepat dia dapat");
      expect(body.embeds?.[0]?.thumbnail?.url).toContain("/cards/c1.webp");
      const ids = (body.components?.[0]?.components ?? []).map(
        (c) => c.custom_id ?? "",
      );
      expect(ids[0]).toContain("give:claim:");
      expect(ids[1]).toContain("give:cancel:");
      // The card only moves when someone claims.
      expect(await quantityOf("u1", "common-01")).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a giver claim click without touching waitUntil", async () => {
    const created = await createGive(db, { mode: "public", giverId: "u1", targetId: null, targetIsBot: false, cardId: "common-01", now: 1_000 });
    if (created.status !== "ok") throw new Error("expected ok");
    const { tasks, waitUntil } = captureTasks();
    const res = await handleGiveClick(
      component(`give:claim:${created.giveId}`, "u1"),
      env,
      waitUntil,
    );
    expect(tasks).toHaveLength(0);
    expect(res.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(await quantityOf("u1", "common-01")).toBe(1);
  });

  it("patches the message once when the target accepts", async () => {
    const created = await createGive(db, {
      mode: "direct",
      giverId: "u1",
      targetId: "u2",
      targetIsBot: false,
      cardId: "common-01",
      now: Math.floor(Date.now() / 1000),
    });
    if (created.status !== "ok") throw new Error("expected ok");
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = await handleGiveClick(
        component(`give:accept:${created.giveId}`, "u2"),
        env,
        waitUntil,
      );
      expect(res.type).toBe(InteractionResponseType.DeferredMessageUpdate);
      await Promise.all(tasks.map((t) => t.catch(() => {})));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toContain("/messages/@original");
      const body = calls[0]?.body as {
        embeds?: { description?: string }[];
        components?: unknown[];
      };
      expect(body.embeds?.[0]?.description).toContain("Diterima");
      expect(body.components ?? []).toHaveLength(0);
      expect(await quantityOf("u2", "common-01")).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
