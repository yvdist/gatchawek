import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { createDb, type Db } from "../src/db/client.js";
import {
  albumTokens,
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import {
  ALBUM_TOKEN_TTL_SEC,
  generateAlbumTokenHex,
  isLinkPreviewCrawler,
  isValidAlbumToken,
  maskAlbumSlot,
} from "../src/domain/album.js";
import {
  createAlbumToken,
  redeemAlbumToken,
  searchAlbumPools,
} from "../src/db/queries/album.js";
import {
  handleAlbum,
  handleAlbumAutocomplete,
  handleAlbumWebRequest,
} from "../src/commands/album/handler.js";
import { app } from "../src/index.js";
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

function albumSlash(
  userId: string,
  pool?: string,
): APIChatInputApplicationCommandInteraction {
  const options =
    pool === undefined
      ? []
      : [
          {
            name: "pool",
            type: ApplicationCommandOptionType.String,
            value: pool,
          },
        ];
  return {
    type: InteractionType.ApplicationCommand,
    id: "int-album-1",
    application_id: "app-id",
    token: "int-token",
    version: 1,
    app_permissions: "0",
    channel_id: "ch-1",
    channel: { id: "ch-1", type: 0 },
    data: {
      id: "cmd-album",
      name: "album",
      type: 1,
      options,
    },
    member: {
      nick: "Kolektor Utama",
      user: {
        id: userId,
        username: "kolektor",
        discriminator: "0",
        avatar: "avhash",
      },
      roles: [],
      permissions: "0",
      joined_at: "2026-01-01T00:00:00.000Z",
      deaf: false,
      mute: false,
    },
    guild_id: "g-1",
    locale: "id",
    entitlements: [],
    authorizing_integration_owners: {},
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
    PUBLIC_BASE_URL: "binder.example.test",
    DISCORD_BOT_TOKEN: "bot-token",
  };
  db = createDb(env);

  await db.insert(pools).values({
    id: "pejabat",
    name: "Pejabat",
    emoji: "🏛️",
    staminaMax: 10,
    regenIntervalSec: 1500,
    resetCooldownSec: 3600,
    memberCount: 2,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "kabinet",
    poolId: "pejabat",
    name: "Kabinet Merah Putih",
    badge: "KABINET",
    memberCount: 2,
    enabled: true,
  });
  await db.insert(members).values([
    {
      id: "m-isa",
      poolId: "pejabat",
      groupId: "kabinet",
      name: "Isa",
      nameLower: "isa",
      fullName: "Lee Chae-young",
      photoTotal: 2,
      sortOrder: 0,
      enabled: true,
    },
    {
      id: "m-misteri",
      poolId: "pejabat",
      groupId: "kabinet",
      name: "Tokoh Rahasia",
      nameLower: "tokoh rahasia",
      fullName: null,
      photoTotal: 1,
      sortOrder: 1,
      enabled: true,
    },
  ]);
  await db.insert(cards).values([
    {
      id: "m-isa-01",
      poolId: "pejabat",
      groupId: "kabinet",
      memberId: "m-isa",
      serial: 101,
      photoNo: 1,
      rarity: "ultra_rare",
      photoLabel: "Edisi Panggung",
      imageFile: "m-isa-01.12345678.webp",
      enabled: true,
      holoEnabled: true,
    },
    {
      id: "m-isa-02",
      poolId: "pejabat",
      groupId: "kabinet",
      memberId: "m-isa",
      serial: 102,
      photoNo: 2,
      rarity: "common",
      photoLabel: null,
      imageFile: "m-isa-02.12345678.webp",
      enabled: true,
      holoEnabled: false,
    },
    {
      id: "m-misteri-01",
      poolId: "pejabat",
      groupId: "kabinet",
      memberId: "m-misteri",
      serial: 103,
      photoNo: 1,
      rarity: "secret",
      photoLabel: "Pose Langka",
      imageFile: "m-misteri-01.87654321.gif",
      enabled: true,
      holoEnabled: true,
    },
  ]);
});

afterAll(async () => {
  await mf.dispose();
});

beforeEach(async () => {
  await db.delete(albumTokens);
  await db.delete(userCards);
  await db.delete(users);
  await db.insert(users).values([{ id: "u1", createdAt: 1000 }]);
  await db.insert(userCards).values([
    {
      userId: "u1",
      cardId: "m-isa-01",
      quantity: 2,
      holoQty: 1,
      firstObtainedAt: 1700000000,
      lastObtainedAt: 1700005000,
    },
  ]);
});

describe("domain/album pure helpers", () => {
  it("generates and validates 48-char hex tokens", () => {
    const bytes = new Uint8Array(24);
    for (let i = 0; i < 24; i += 1) bytes[i] = i * 7;
    const token = generateAlbumTokenHex(bytes);
    expect(token).toHaveLength(48);
    expect(isValidAlbumToken(token)).toBe(true);
    expect(isValidAlbumToken("invalid-token!")).toBe(false);
    expect(isValidAlbumToken("abc")).toBe(false);
  });

  it("identifies automated link preview crawlers so they do not burn tokens", () => {
    expect(
      isLinkPreviewCrawler(
        "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      ),
    ).toBe(true);
    expect(isLinkPreviewCrawler("WhatsApp/2.23.10.76 A")).toBe(true);
    expect(isLinkPreviewCrawler("Twitterbot/1.0")).toBe(true);
    expect(
      isLinkPreviewCrawler(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0",
      ),
    ).toBe(false);
  });

  it("masks unowned card image URLs and censors unowned holo/secret identities", () => {
    const owned = maskAlbumSlot(
      {
        cardId: "c1",
        poolId: "p1",
        groupId: "g1",
        memberId: "m1",
        memberName: "Isa",
        fullName: "Lee Chae-young",
        photoLabel: "Panggung",
        serial: 10,
        photoNo: 1,
        photoTotal: 3,
        rarity: "secret",
        holoEnabled: true,
        imageFile: "c1.11223344.gif",
        quantity: 1,
        holoQty: 0,
        firstObtainedAt: 100,
        lastObtainedAt: 200,
      },
      "binder.example.test",
    );
    expect(owned.owned).toBe(true);
    expect(owned.hiddenMystery).toBe(false);
    expect(owned.memberName).toBe("Isa");
    expect(owned.imageUrl).toBe(
      "https://binder.example.test/cards/c1.11223344.gif",
    );

    const unownedSecret = maskAlbumSlot(
      {
        cardId: "c2",
        poolId: "p1",
        groupId: "g1",
        memberId: "m2",
        memberName: "Tokoh Rahasia",
        fullName: "Nama Lengkap",
        photoLabel: "Pose Langka",
        serial: 11,
        photoNo: 1,
        photoTotal: 1,
        rarity: "secret",
        holoEnabled: true,
        imageFile: "c2.11223344.gif",
        quantity: 0,
        holoQty: 0,
        firstObtainedAt: null,
        lastObtainedAt: null,
      },
      "binder.example.test",
    );
    expect(unownedSecret.owned).toBe(false);
    expect(unownedSecret.hiddenMystery).toBe(true);
    expect(unownedSecret.imageUrl).toBeNull();
    expect(unownedSecret.memberName).toBe("***** *******");
    expect(unownedSecret.photoLabel).toBe("**** ******");
    expect(unownedSecret.fullName).toBeNull();
  });
});

describe("single-use /album token lifecycle & web binder rendering", () => {
  it("allows opening the binder URL once, then rejects subsequent accesses and expired tokens", async () => {
    const token = "a".repeat(48);
    const nowSec = Math.floor(Date.now() / 1000);
    const created = await createAlbumToken(db, {
      token,
      userId: "u1",
      displayName: "Kolektor Utama",
      avatarUrl: null,
      poolId: null,
      now: nowSec,
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;
    expect(created.summary.uniqueOwnedCards).toBe(1);
    expect(created.summary.totalCatalogCards).toBe(3);
    expect(created.summary.totalCopies).toBe(3);
    expect(created.summary.totalHoloCopies).toBe(1);

    // 1. Link preview crawler does NOT consume the token.
    const crawlerRes = await handleAlbumWebRequest({
      token,
      userAgent: "Discordbot/2.0",
      method: "GET",
      env,
    });
    expect(crawlerRes.status).toBe(200);
    expect(crawlerRes.html).toContain("Tautan sekali pakai siap dibuka");

    // 2. HEAD request does NOT consume the token.
    const headRes = await handleAlbumWebRequest({
      token,
      userAgent: "Mozilla/5.0 Chrome/130.0",
      method: "HEAD",
      env,
    });
    expect(headRes.status).toBe(200);

    // 3. First real browser GET succeeds and renders the interactive binder.
    const firstOpen = await app.request(
      `http://localhost/album/${token}`,
      {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 Chrome/130.0" },
      },
      env,
    );
    expect(firstOpen.status).toBe(200);
    expect(firstOpen.headers.get("cache-control")).toContain("no-store");
    const html = await firstOpen.text();
    expect(html).toContain("Buku Koleksi Kolektor Utama");
    expect(html).toContain("m-isa-01.12345678.webp");
    // Unowned secret card image file and real name must NOT leak in the HTML payload.
    expect(html).not.toContain("m-misteri-01.87654321.gif");
    expect(html).not.toContain("Tokoh Rahasia");
    expect(html).toContain("***** *******");
    // Antislop R-02: zero em dashes in HTML output.
    expect(html).not.toContain("\u2014");

    // 4. Second real browser GET with the same URL is rejected with 410 Gone.
    const secondOpen = await app.request(
      `http://localhost/album/${token}`,
      {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 Chrome/130.0" },
      },
      env,
    );
    expect(secondOpen.status).toBe(410);
    const usedHtml = await secondOpen.text();
    expect(usedHtml).toContain("Tautan Sekali Pakai Sudah Terpakai");
    expect(usedHtml).toContain("/album");
    expect(usedHtml).not.toContain("\u2014");
  });

  it("invalidates previous unused token when user runs /album again and rejects expired tokens", async () => {
    const token1 = "1".repeat(48);
    const token2 = "2".repeat(48);
    await createAlbumToken(db, {
      token: token1,
      userId: "u1",
      displayName: "Kolektor",
      avatarUrl: null,
      poolId: null,
      now: 1000,
    });
    await createAlbumToken(db, {
      token: token2,
      userId: "u1",
      displayName: "Kolektor",
      avatarUrl: null,
      poolId: null,
      now: 1010,
    });

    // token1 was superseded by token2
    const oldOutcome = await redeemAlbumToken(db, {
      token: token1,
      claimToken: "claim-1",
      now: 1020,
      publicBaseUrl: env.PUBLIC_BASE_URL,
    });
    expect(oldOutcome.status).toBe("not-found");

    // token2 accessed after TTL expires
    const expiredOutcome = await redeemAlbumToken(db, {
      token: token2,
      claimToken: "claim-2",
      now: 1010 + ALBUM_TOKEN_TTL_SEC + 1,
      publicBaseUrl: env.PUBLIC_BASE_URL,
    });
    expect(expiredOutcome.status).toBe("expired");
  });

  it("handles /album Discord interaction ephemerally and supports pool autocomplete", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleAlbum(albumSlash("u1", "pejabat"), env, waitUntil);
      expect(res.type).toBe(
        InteractionResponseType.DeferredChannelMessageWithSource,
      );
      expect((res as { data?: { flags?: number } }).data?.flags).toBe(64);
      await Promise.all(tasks);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] ?? [];
      const payload = JSON.parse((init?.body as string) ?? "{}") as {
        embeds?: { title?: string; description?: string }[];
        components?: { components?: { url?: string; label?: string }[] }[];
      };
      expect(payload.embeds?.[0]?.title).toContain("Buku Koleksi Photocard");
      expect(payload.embeds?.[0]?.description).toContain("1/3");
      const linkUrl = payload.components?.[0]?.components?.[0]?.url ?? "";
      expect(linkUrl).toMatch(
        /^https:\/\/binder\.example\.test\/album\/[0-9a-f]{48}$/,
      );

      // Verify autocomplete returns live pools dynamically
      const acRes = await handleAlbumAutocomplete(
        {
          type: InteractionType.ApplicationCommandAutocomplete,
          data: {
            id: "cmd-album",
            name: "album",
            type: 1,
            options: [
              { name: "pool", type: 3, value: "Pej", focused: true },
            ],
          },
        } as unknown as APIApplicationCommandAutocompleteInteraction,
        env,
      );
      expect(acRes.data.choices).toEqual([
        { name: "🏛️ Pejabat", value: "pejabat" },
      ]);
      const directChoices = await searchAlbumPools(db, "");
      expect(directChoices).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
