import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { createDb } from "../src/db/client.js";
import { cards, groups, members, pools } from "../src/db/schema.js";
import {
  clampListPage,
  isListButtonOwner,
  LIST_PAGE_SIZE,
  listPageCustomId,
  parseListPageCustomId,
} from "../src/domain/list.js";
import { getListPage } from "../src/db/queries/list.js";
import {
  handleList,
  handleListAutocomplete,
  handleListPage,
} from "../src/commands/list/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let env: Env;

function captureTasks(): { tasks: Promise<unknown>[]; waitUntil: WaitUntil } {
  const tasks: Promise<unknown>[] = [];
  return { tasks, waitUntil: (p) => void tasks.push(p) };
}

function listInteraction(
  userId: string,
  options: { pool?: string; grup?: string; publik?: boolean } = {},
): APIChatInputApplicationCommandInteraction {
  const opts: NonNullable<
    APIChatInputApplicationCommandInteraction["data"]["options"]
  > = [];
  if (options.pool !== undefined) {
    opts.push({
      name: "pool",
      type: ApplicationCommandOptionType.String,
      value: options.pool,
    });
  }
  if (options.grup !== undefined) {
    opts.push({
      name: "grup",
      type: ApplicationCommandOptionType.String,
      value: options.grup,
    });
  }
  if (options.publik !== undefined) {
    opts.push({
      name: "publik",
      type: ApplicationCommandOptionType.Boolean,
      value: options.publik,
    });
  }
  return {
    type: InteractionType.ApplicationCommand,
    id: "i1",
    application_id: "app1",
    token: "tok1",
    version: 1,
    app_permissions: "0",
    channel_id: "c1",
    channel: { id: "c1", type: 0 },
    data: {
      id: "cmd-list",
      name: "list",
      type: 1,
      options: opts,
    },
    member: {
      user: { id: userId, username: "tester", discriminator: "0" },
      roles: [],
      permissions: "0",
      joined_at: "2024-01-01T00:00:00Z",
      deaf: false,
      mute: false,
    },
    guild_id: "g1",
    locale: "id",
    entitlements: [],
    authorizing_integration_owners: {},
  } as unknown as APIChatInputApplicationCommandInteraction;
}

function componentInteraction(
  customId: string,
  clickerId: string,
): APIMessageComponentInteraction {
  return {
    type: InteractionType.MessageComponent,
    id: "i2",
    application_id: "app1",
    token: "tok2",
    version: 1,
    app_permissions: "0",
    channel_id: "c1",
    channel: { id: "c1", type: 0 },
    data: { component_type: 2, custom_id: customId },
    member: {
      user: { id: clickerId, username: "tester", discriminator: "0" },
      roles: [],
      permissions: "0",
      joined_at: "2024-01-01T00:00:00Z",
      deaf: false,
      mute: false,
    },
    guild_id: "g1",
    locale: "id",
    entitlements: [],
    authorizing_integration_owners: {},
  } as unknown as APIMessageComponentInteraction;
}

function autocompleteInteraction(
  options: { name: string; value: string; focused?: boolean }[],
): APIApplicationCommandAutocompleteInteraction {
  return {
    type: InteractionType.ApplicationCommandAutocomplete,
    id: "i3",
    application_id: "app1",
    token: "tok3",
    version: 1,
    app_permissions: "0",
    channel_id: "c1",
    data: {
      id: "cmd-list",
      name: "list",
      type: 1,
      options: options.map((o) => ({
        name: o.name,
        type: ApplicationCommandOptionType.String,
        value: o.value,
        focused: o.focused ?? false,
      })),
    },
    locale: "id",
    entitlements: [],
    authorizing_integration_owners: {},
  } as unknown as APIApplicationCommandAutocompleteInteraction;
}

describe("domain/list", () => {
  it("clamps pages safely", () => {
    expect(clampListPage(-1, 3)).toBe(0);
    expect(clampListPage(0, 3)).toBe(0);
    expect(clampListPage(5, 3)).toBe(2);
    expect(clampListPage(1, 0)).toBe(0);
    expect(clampListPage(Number.NaN, 3)).toBe(0);
  });

  it("checks owner gate", () => {
    expect(isListButtonOwner("u1", "u1")).toBe(true);
    expect(isListButtonOwner("u2", "u1")).toBe(false);
    expect(isListButtonOwner(null, "u1")).toBe(false);
  });

  it("round-trips list page custom_id", () => {
    const id = listPageCustomId("u1", "pejabat", "*", 2);
    expect(id).toBe("list:p:u1:pejabat:*:2");
    expect(parseListPageCustomId(id)).toEqual({
      ownerId: "u1",
      poolKey: "pejabat",
      groupKey: "*",
      page: 2,
    });
    expect(parseListPageCustomId("koleksi:p:u1:pejabat:*:2")).toBeNull();
    expect(parseListPageCustomId("list:p:u1::*:2")).toBeNull();
    expect(parseListPageCustomId("list:p:u1:pejabat:*:abc")).toBeNull();
  });
});

describe("/list queries and interactions", () => {
  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } }",
      d1Databases: { DB: "list-test-db" },
    });
    const d1 = await mf.getD1Database("DB");
    const migDir = path.join(REPO_ROOT, "migrations");
    const files = (await readdir(migDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const raw = await readFile(path.join(migDir, file), "utf8");
      for (const stmt of raw.split("--> statement-breakpoint")) {
        const trimmed = stmt.trim();
        if (trimmed !== "") await d1.prepare(trimmed).run();
      }
    }
    env = {
      DB: d1,
      CARDS: {} as Env["CARDS"],
      DISCORD_APPLICATION_ID: "app1",
      DISCORD_PUBLIC_KEY: "00",
      DISCORD_BOT_TOKEN: "bot-tok",
      PUBLIC_BASE_URL: "https://example.com",
      ADMIN_PASSWORD: "pw",
      ADMIN_SECRET: "sec",
      GUILD_ID: "g1",
      INGEST_CHANNEL_ID: "ch1",
      APPROVER_USER_IDS: "",
    };
  });

  afterAll(async () => {
    await mf.dispose();
  });

  beforeEach(async () => {
    const db = createDb(env);
    await db.delete(cards);
    await db.delete(members);
    await db.delete(groups);
    await db.delete(pools);

    await db.insert(pools).values([
      { id: "pejabat", name: "Pejabat", emoji: "🏛️", sortOrder: 1, enabled: true },
      { id: "meme", name: "Meme", emoji: "😂", sortOrder: 2, enabled: true },
      { id: "hidden-pool", name: "Hidden", emoji: "🚫", sortOrder: 3, enabled: false },
    ]);

    await db.insert(groups).values([
      { id: "kabinet", poolId: "pejabat", name: "Kabinet", badge: "🇮🇩", sortOrder: 1, enabled: true },
      { id: "dpr", poolId: "pejabat", name: "DPR", badge: "🏢", sortOrder: 2, enabled: true },
      { id: "jomok", poolId: "meme", name: "Jomok", badge: "🗿", sortOrder: 1, enabled: true },
      { id: "secret-only", poolId: "meme", name: "Rahasia", badge: "🕵️", sortOrder: 2, enabled: true },
    ]);

    await db.insert(members).values([
      { id: "m-budi", poolId: "pejabat", groupId: "kabinet", name: "Budi", nameLower: "budi", photoTotal: 2, sortOrder: 1, enabled: true },
      { id: "m-siti", poolId: "pejabat", groupId: "dpr", name: "Siti", nameLower: "siti", photoTotal: 1, sortOrder: 1, enabled: true },
      { id: "m-refi", poolId: "meme", groupId: "jomok", name: "Refi", nameLower: "refi", photoTotal: 2, sortOrder: 1, enabled: true },
      { id: "m-ghost", poolId: "meme", groupId: "secret-only", name: "Ghost", nameLower: "ghost", photoTotal: 1, sortOrder: 1, enabled: true },
    ]);

    await db.insert(cards).values([
      {
        id: "c1",
        poolId: "pejabat",
        groupId: "kabinet",
        memberId: "m-budi",
        serial: 1,
        photoNo: 1,
        rarity: "common",
        photoLabel: "Senyum",
        imageFile: "c1.webp",
        enabled: true,
        holoEnabled: false,
      },
      {
        id: "c2-secret",
        poolId: "pejabat",
        groupId: "kabinet",
        memberId: "m-budi",
        serial: 2,
        photoNo: 2,
        rarity: "secret",
        photoLabel: "Rahasia Negara",
        imageFile: "c2.webp",
        enabled: true,
        holoEnabled: true,
      },
      {
        id: "c3",
        poolId: "pejabat",
        groupId: "dpr",
        memberId: "m-siti",
        serial: 3,
        photoNo: 1,
        rarity: "rare",
        photoLabel: null,
        imageFile: "c3.webp",
        enabled: true,
        holoEnabled: false,
      },
      {
        id: "c4",
        poolId: "meme",
        groupId: "jomok",
        memberId: "m-refi",
        serial: 1,
        photoNo: 1,
        rarity: "holo",
        photoLabel: "Kaget",
        imageFile: "c4.webp",
        enabled: true,
        holoEnabled: true,
      },
      {
        id: "c5-disabled",
        poolId: "meme",
        groupId: "jomok",
        memberId: "m-refi",
        serial: 2,
        photoNo: 2,
        rarity: "ultra_rare",
        photoLabel: "Nonaktif",
        imageFile: "c5.webp",
        enabled: false,
        holoEnabled: false,
      },
      {
        id: "c6-secret-only",
        poolId: "meme",
        groupId: "secret-only",
        memberId: "m-ghost",
        serial: 3,
        photoNo: 1,
        rarity: "secret",
        photoLabel: "Top Secret",
        imageFile: "c6.webp",
        enabled: true,
        holoEnabled: true,
      },
    ]);
  });

  it("never returns secret or disabled cards across all pools, by pool, or by group", async () => {
    const db = createDb(env);

    const all = await getListPage(db, { poolId: null, groupId: null }, 0);
    expect(all.status).toBe("ok");
    if (all.status === "ok") {
      expect(all.totalCards).toBe(3);
      expect(all.cards.map((c) => c.cardId)).toEqual(["c1", "c3", "c4"]);
    }

    const byPool = await getListPage(db, { poolId: "pejabat", groupId: null }, 0);
    expect(byPool.status).toBe("ok");
    if (byPool.status === "ok") {
      expect(byPool.totalCards).toBe(2);
      expect(byPool.cards.map((c) => c.cardId)).toEqual(["c1", "c3"]);
    }

    const byGroupOnly = await getListPage(db, { poolId: null, groupId: "jomok" }, 0);
    expect(byGroupOnly.status).toBe("ok");
    if (byGroupOnly.status === "ok") {
      expect(byGroupOnly.totalCards).toBe(1);
      expect(byGroupOnly.cards.map((c) => c.cardId)).toEqual(["c4"]);
    }

    const secretOnlyGroup = await getListPage(
      db,
      { poolId: null, groupId: "secret-only" },
      0,
    );
    expect(secretOnlyGroup.status).toBe("empty");
  });

  it("rejects unknown pool or mismatched pool+group", async () => {
    const db = createDb(env);
    expect(
      await getListPage(db, { poolId: "hidden-pool", groupId: null }, 0),
    ).toEqual({ status: "unknown-pool" });
    expect(
      await getListPage(db, { poolId: "pejabat", groupId: "jomok" }, 0),
    ).toEqual({ status: "unknown-group" });
  });

  it("autocompletes pools and excludes secret-only groups", async () => {
    const poolRes = await handleListAutocomplete(
      autocompleteInteraction([{ name: "pool", value: "", focused: true }]),
      env,
    );
    expect(poolRes.type).toBe(
      InteractionResponseType.ApplicationCommandAutocompleteResult,
    );
    if (
      poolRes.type ===
      InteractionResponseType.ApplicationCommandAutocompleteResult
    ) {
      expect(poolRes.data.choices.map((c) => c.value)).toEqual([
        "pejabat",
        "meme",
      ]);
    }

    const groupRes = await handleListAutocomplete(
      autocompleteInteraction([
        { name: "pool", value: "meme" },
        { name: "grup", value: "", focused: true },
      ]),
      env,
    );
    if (
      groupRes.type ===
      InteractionResponseType.ApplicationCommandAutocompleteResult
    ) {
      expect(groupRes.data.choices.map((c) => c.value)).toEqual(["jomok"]);
    }
  });

  it("paginates multi-page results and enforces ownerGate on Prev/Next", async () => {
    const db = createDb(env);
    const bulkCards = Array.from({ length: LIST_PAGE_SIZE + 2 }, (_, idx) => ({
      id: `bulk-${idx + 1}`,
      poolId: "meme",
      groupId: "jomok",
      memberId: "m-refi",
      serial: 100 + idx,
      photoNo: 10 + idx,
      rarity: "common" as const,
      photoLabel: `Pose ${idx + 1}`,
      imageFile: `b-${idx}.webp`,
      enabled: true,
      holoEnabled: false,
    }));
    for (let i = 0; i < bulkCards.length; i += 5) {
      await db.insert(cards).values(bulkCards.slice(i, i + 5));
    }

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "msg1" }), { status: 200 }));

    try {
      const { tasks, waitUntil } = captureTasks();
      const ack = handleList(
        listInteraction("owner-1", { pool: "meme", grup: "jomok", publik: false }),
        env,
        waitUntil,
      );
      expect(ack.type).toBe(
        InteractionResponseType.DeferredChannelMessageWithSource,
      );
      await Promise.all(tasks);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const firstBody = JSON.parse(
        String(fetchSpy.mock.calls[0]?.[1]?.body ?? "{}"),
      ) as {
        flags?: number;
        embeds?: { description?: string; footer?: { text?: string } }[];
        components?: { components?: { custom_id?: string; disabled?: boolean }[] }[];
      };
      expect(firstBody.flags).toBe(64);
      expect(firstBody.embeds?.[0]?.description).not.toContain("Rahasia");
      expect(firstBody.embeds?.[0]?.footer?.text).toContain("Total 18 kartu · Hal 1/2");

      const nextCustomId =
        firstBody.components?.[0]?.components?.[1]?.custom_id ?? "";
      expect(nextCustomId).toBe("list:p:owner-1:meme:jomok:1");

      // Third party click is rejected synchronously.
      const thirdPartyRes = handleListPage(
        componentInteraction(nextCustomId, "intruder"),
        env,
        waitUntil,
      );
      expect(thirdPartyRes.type).toBe(
        InteractionResponseType.ChannelMessageWithSource,
      );

      // Owner click updates to page 2.
      const tasks2 = captureTasks();
      const ownerRes = handleListPage(
        componentInteraction(nextCustomId, "owner-1"),
        env,
        tasks2.waitUntil,
      );
      expect(ownerRes.type).toBe(InteractionResponseType.DeferredMessageUpdate);
      await Promise.all(tasks2.tasks);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(
        String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}"),
      ) as {
        embeds?: { footer?: { text?: string } }[];
      };
      expect(secondBody.embeds?.[0]?.footer?.text).toContain("Total 18 kartu · Hal 2/2");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
