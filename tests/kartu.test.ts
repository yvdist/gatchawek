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
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { createDb, type Db } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
  userCards,
  users,
} from "../src/db/schema.js";
import {
  CARD_MOTIFS,
  computeJabatan,
  deriveBarcodeWidths,
  deriveBirthInfo,
  deriveBloodType,
  deriveCardTheme,
  deriveNim,
  formatAndalan,
  formatIndonesianDate,
  formatKoleksiRingkas,
  formatPoolFavorit,
  rarityRank,
  resolveJoinTimestamp,
  sanitizeAsciiText,
} from "../src/domain/kartu.js";
import { getKartuProfileStats } from "../src/db/queries/kartu.js";
import {
  decodePngToRgba,
  encodeRgbaToPng,
  KARTU_HEIGHT,
  KARTU_WIDTH,
  renderKartuPixels,
  renderKartuPng,
} from "../src/ui/kartuImage.js";
import { kartuDefinition } from "../src/commands/kartu/definition.js";
import {
  extractCallerIdentity,
  handleKartu,
} from "../src/commands/kartu/handler.js";
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

function kartuSlash(
  callerId: string,
  opts?: {
    username?: string;
    nick?: string;
    avatar?: string | null;
    joinedAt?: string;
  },
): APIChatInputApplicationCommandInteraction {
  return {
    type: InteractionType.ApplicationCommand,
    id: "int-kartu-1",
    application_id: "app-id",
    guild_id: "guild-1",
    token: "tok-kartu",
    version: 1,
    app_permissions: "0",
    channel_id: "ch-1",
    channel: { id: "ch-1", type: 0 },
    data: {
      id: "cmd-kartu",
      name: "kartu",
      type: 1,
    },
    member: {
      user: {
        id: callerId,
        username: opts?.username ?? "rep5900",
        global_name: "Sannohzzz",
        discriminator: "0",
        avatar: opts?.avatar ?? null,
      },
      nick: opts?.nick ?? "Sannohzzz",
      avatar: null,
      roles: [],
      premium_since: null,
      pending: false,
      permissions: "0",
      joined_at: opts?.joinedAt ?? "2026-04-01T05:00:00.000Z",
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
  db = createDb({ DB: d1 } as Env);
  env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: d1,
    CARDS: {} as Env["CARDS"],
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "bot-token",
    INGEST_CHANNEL_ID: "ch",
    INGEST_GUILD_ID: "g",
    INJECT_APPROVER_IDS: "",
    ADMIN_PASSWORD: "pw",
    ADMIN_SECRET: "sec",
  };

  await db.insert(pools).values([
    {
      id: "pool-a",
      name: "Pejabat",
      emoji: "🏛️",
      sortOrder: 0,
      memberCount: 15,
    },
    {
      id: "pool-b",
      name: "Jomok",
      emoji: "🐸",
      sortOrder: 1,
      memberCount: 10,
    },
  ]);
  await db.insert(groups).values([
    {
      id: "grp-a",
      poolId: "pool-a",
      name: "Kabinet",
      badge: "KABINET",
      memberCount: 15,
    },
    {
      id: "grp-b",
      poolId: "pool-b",
      name: "Meme",
      badge: "MEME",
      memberCount: 10,
    },
  ]);
  await db.insert(members).values([
    {
      id: "mem-1",
      poolId: "pool-a",
      groupId: "grp-a",
      name: "Prabowo",
      nameLower: "prabowo",
      photoTotal: 3,
    },
    {
      id: "mem-2",
      poolId: "pool-a",
      groupId: "grp-a",
      name: "Gibran",
      nameLower: "gibran",
      photoTotal: 3,
    },
    {
      id: "mem-3",
      poolId: "pool-b",
      groupId: "grp-b",
      name: "Ambatukam",
      nameLower: "ambatukam",
      photoTotal: 3,
    },
  ]);
  await db.insert(cards).values([
    {
      id: "mem-1-01",
      poolId: "pool-a",
      groupId: "grp-a",
      memberId: "mem-1",
      serial: 1,
      photoNo: 1,
      rarity: "common",
      imageFile: "mem-1-01.aaaaaaaa.webp",
      enabled: true,
    },
    {
      id: "mem-2-01",
      poolId: "pool-a",
      groupId: "grp-a",
      memberId: "mem-2",
      serial: 2,
      photoNo: 1,
      rarity: "ultra_rare",
      imageFile: "mem-2-01.bbbbbbbb.webp",
      enabled: true,
    },
    {
      id: "mem-3-01",
      poolId: "pool-b",
      groupId: "grp-b",
      memberId: "mem-3",
      serial: 1,
      photoNo: 1,
      rarity: "rare",
      imageFile: "mem-3-01.cccccccc.webp",
      enabled: true,
    },
  ]);
});

afterAll(async () => {
  await mf.dispose();
});

beforeEach(async () => {
  await db.delete(userCards);
  await db.delete(users);
});

describe("domain/kartu pure helpers & unique themes", () => {
  it("defines /kartu without any <user> option (caller-only)", () => {
    expect(kartuDefinition.name).toBe("kartu");
    expect("options" in kartuDefinition).toBe(false);
  });

  it("derives deterministic 10-digit NIM, blood type, birth info, and unique themes per member", () => {
    const nim = deriveNim("869121487020372020");
    expect(nim).toMatch(/^[1-9][0-9]{9}$/);
    expect(deriveNim("869121487020372020")).toBe(nim);
    expect(deriveNim("123456789012345678")).not.toBe(nim);

    const blood = deriveBloodType("869121487020372020");
    expect(["A", "B", "AB", "O"]).toContain(blood);

    const birth = deriveBirthInfo("869121487020372020");
    expect(birth).toMatch(/^[A-Za-z]+, \d{1,2} [A-Za-z]+ \d{4}$/);

    const theme1 = deriveCardTheme("869121487020372020");
    const theme2 = deriveCardTheme("223344556677889901");
    expect(CARD_MOTIFS).toContain(theme1.motif);
    expect(CARD_MOTIFS).toContain(theme2.motif);
    expect(deriveCardTheme("869121487020372020")).toEqual(theme1);
    expect(theme1).not.toEqual(theme2);
  });

  it("formats dates, jabatan, andalan, pool favorit, and koleksi summary", () => {
    const apr1 = Math.floor(Date.parse("2026-04-01T00:00:00Z") / 1000);
    expect(formatIndonesianDate(apr1)).toBe("1 April 2026");

    expect(
      resolveJoinTimestamp("2026-04-01T00:00:00Z", 1700000000, null, 1800000000),
    ).toBe(apr1);
    expect(resolveJoinTimestamp(null, 1700000000, 1690000000, 1800000000)).toBe(
      1690000000,
    );

    expect(computeJabatan(null, 0)).toEqual({
      title: "Warga Sipil",
      colorHex: "#9CA3AF",
    });
    expect(computeJabatan("common", 1)).toEqual({
      title: "Commoner",
      colorHex: "#4ADE80",
    });
    expect(computeJabatan("secret", 5).title).toBe("Sepuh Agung");
    expect(rarityRank("secret")).toBeGreaterThan(rarityRank("common"));

    expect(formatAndalan(null, 0)).toBe("-");
    expect(formatAndalan("Reze", 1)).toBe("Reze");
    expect(formatAndalan("Reze", 26)).toBe("Reze (+25 lainnya)");

    expect(formatPoolFavorit(null)).toBe("-");
    expect(
      formatPoolFavorit({
        poolName: "Pejabat",
        ownedMembers: 8,
        totalMembers: 15,
      }),
    ).toBe("Pejabat (8/15)");

    expect(formatKoleksiRingkas(0, 0, 0)).toBe("Belum punya");
    expect(formatKoleksiRingkas(10, 6, 0)).toBe("10 Kartu (6 Tokoh)");
    expect(formatKoleksiRingkas(10, 6, 2)).toBe("10 Kartu (2 Holo)");

    expect(sanitizeAsciiText("Sannohzzz 🎉", 12)).toBe("Sannohzzz");
    expect(sanitizeAsciiText("NamaYangSangatPanjangSekali", 10)).toBe("NamaYan...");
    expect(deriveBarcodeWidths("869121487020372020").length).toBeGreaterThan(20);
  });
});

describe("ui/kartuImage PNG renderer & decoder", () => {
  it("renders distinct backgrounds for different userIds and round-trips RGBA PNG", async () => {
    const baseFields = {
      displayName: "Sannohzzz",
      username: "rep5900",
      nim: "7601932684",
      bloodType: "A",
      birthInfo: "Palembang, 21 Juli 1997",
      koleksiText: "26 Kartu (3 Holo)",
      joinedText: "1 April 2026",
      jabatanTitle: "Commoner",
      jabatanColorHex: "#4ADE80",
      andalanText: "Reze (+25 lainnya)",
      poolFavoritText: "Pejabat (8/15)",
    };

    const pixelsA = renderKartuPixels({
      ...baseFields,
      userId: "869121487020372020",
    });
    const pixelsB = renderKartuPixels({
      ...baseFields,
      userId: "223344556677889901",
    });

    const probeIdx = 100 * KARTU_WIDTH + 480;
    expect(pixelsA[probeIdx]).not.toBe(pixelsB[probeIdx]);

    const smallAvatarPixels = new Uint32Array(16 * 16).fill(0xff8040d0);
    const smallAvatarPng = await encodeRgbaToPng(smallAvatarPixels, 16, 16);
    const decodedAvatar = await decodePngToRgba(smallAvatarPng);
    expect(decodedAvatar).not.toBeNull();

    const png = await renderKartuPng({
      ...baseFields,
      userId: "869121487020372020",
      avatar: decodedAvatar,
    });

    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    expect(png[2]).toBe(78);
    expect(png[3]).toBe(71);

    const decodedCard = await decodePngToRgba(png);
    expect(decodedCard).not.toBeNull();
    expect(decodedCard?.width).toBe(KARTU_WIDTH);
    expect(decodedCard?.height).toBe(KARTU_HEIGHT);
  });
});

describe("db/queries/kartu & /kartu interaction handler", () => {
  it("queries user profile stats across pools and picks highest rarity as main card", async () => {
    await db.insert(users).values({ id: "u-1", createdAt: 1710000000 });
    await db.insert(userCards).values([
      {
        userId: "u-1",
        cardId: "mem-1-01",
        quantity: 3,
        holoQty: 0,
        firstObtainedAt: 1710000100,
        lastObtainedAt: 1710000200,
      },
      {
        userId: "u-1",
        cardId: "mem-2-01",
        quantity: 1,
        holoQty: 1,
        firstObtainedAt: 1710000300,
        lastObtainedAt: 1710000300,
      },
      {
        userId: "u-1",
        cardId: "mem-3-01",
        quantity: 2,
        holoQty: 0,
        firstObtainedAt: 1710000400,
        lastObtainedAt: 1710000400,
      },
    ]);

    const stats = await getKartuProfileStats(db, "u-1");
    expect(stats.totalCards).toBe(6);
    expect(stats.uniqueMembers).toBe(3);
    expect(stats.totalHolo).toBe(1);
    expect(stats.highestRarity).toBe("ultra_rare");
    expect(stats.topMemberName).toBe("Gibran");
    expect(stats.topPool).toEqual({
      poolName: "Pejabat",
      ownedMembers: 2,
      totalMembers: 15,
    });
  });

  it("handles /kartu for the invoking member only and uploads kartu-identitas.png publicly", async () => {
    await db.insert(users).values({ id: "u-self", createdAt: 1710000000 });
    await db.insert(userCards).values({
      userId: "u-self",
      cardId: "mem-1-01",
      quantity: 2,
      holoQty: 0,
      firstObtainedAt: 1710000100,
      lastObtainedAt: 1710000200,
    });

    const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
      });

    try {
      const selfInteraction = kartuSlash("u-self", {
        username: "rep5900",
        nick: "Sannohzzz",
      });
      const callerInfo = extractCallerIdentity(selfInteraction);
      expect(callerInfo?.userId).toBe("u-self");
      expect(callerInfo?.username).toBe("rep5900");
      expect(callerInfo?.displayName).toBe("Sannohzzz");

      const { tasks, waitUntil } = captureTasks();
      const res = handleKartu(selfInteraction, env, waitUntil);
      expect(res.type).toBe(
        InteractionResponseType.DeferredChannelMessageWithSource,
      );
      await Promise.all(tasks);

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0]?.url).toContain(
        "/api/v10/webhooks/app-id/tok-kartu?wait=true",
      );
      const formBody = fetchCalls[0]?.init?.body;
      expect(formBody).toBeInstanceOf(FormData);
      const form = formBody as FormData;
      const payloadJson = JSON.parse(String(form.get("payload_json"))) as {
        flags?: number;
        attachments: { id: number; filename: string }[];
      };
      expect(payloadJson.flags).toBeUndefined();
      expect(payloadJson.attachments).toEqual([
        { id: 0, filename: "kartu-identitas.png" },
      ]);
      const fileBlob = form.get("files[0]") as Blob;
      expect(fileBlob).toBeInstanceOf(Blob);
      expect(fileBlob.size).toBeGreaterThan(1000);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
