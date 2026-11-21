import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ButtonStyle,
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { createDb } from "../src/db/client.js";
import {
  cards,
  groups,
  members,
  pools,
} from "../src/db/schema.js";
import {
  buildWaShareText,
  buildWaShareUrl,
  type WaShareCard,
} from "../src/domain/share.js";
import {
  WA_SHARE_BUTTON_LABEL,
  buildWaShareRow,
} from "../src/ui/waShare.js";
import { handleGacha } from "../src/commands/gacha/handler.js";
import type { WaitUntil } from "../src/commands/registry.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function baseCard(overrides: Partial<WaShareCard> = {}): WaShareCard {
  return {
    memberName: "Pilip Decul",
    photoLabel: null,
    groupName: "Jomok",
    photoNo: 2,
    photoTotal: 8,
    serial: 7,
    rarity: "rare",
    imageUrl: "https://example.test/cards/pilip-02.x.webp",
    ...overrides,
  };
}

describe("buildWaShareText", () => {
  it("uses memberName when photoLabel is null", () => {
    const text = buildWaShareText(baseCard({ photoLabel: null }));
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("🎴 Pilip Decul (Jomok)");
    expect(lines[1]).toContain("Foto 2/8");
    expect(lines[1]).toContain("No. 7");
    expect(lines[1]).toContain("★★");
    expect(lines[1]).toContain("Rare");
    expect(lines[2]).toBe("https://example.test/cards/pilip-02.x.webp");
  });

  it("prefers photoLabel when the photo has its own identity", () => {
    const text = buildWaShareText(
      baseCard({ photoLabel: "Pose Keren", memberName: "Pilip Decul" }),
    );
    expect(text.split("\n")[0]).toBe("🎴 Pose Keren (Jomok)");
  });

  it("renders unknown total as ? instead of crashing", () => {
    const text = buildWaShareText(baseCard({ photoTotal: 0 }));
    expect(text).toContain("Foto 2/?");
  });

  it("keeps an empty imageUrl as an empty third line", () => {
    const text = buildWaShareText(baseCard({ imageUrl: "" }));
    expect(text.split("\n")).toHaveLength(3);
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("buildWaShareUrl", () => {
  it("round-trips through decodeURIComponent", () => {
    const text = buildWaShareText(baseCard());
    const url = buildWaShareUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(
      text,
    );
  });

  it("stays within Discord's 512-char button URL limit for the longest fixture", () => {
    const text = buildWaShareText(
      baseCard({
        memberName: "A".repeat(60),
        photoLabel: null,
        groupName: "G".repeat(30),
        rarity: "secret",
        imageUrl: `https://example.test/cards/${"f".repeat(70)}.webp`,
      }),
    );
    expect(buildWaShareUrl(text).length).toBeLessThanOrEqual(512);
  });
});

describe("buildWaShareRow", () => {
  it("is a Link button with the locked label and passthrough url", () => {
    const row = buildWaShareRow("https://wa.me/?text=abc");
    expect(WA_SHARE_BUTTON_LABEL).toBe("📤 Share ke WA");
    expect(row.components).toHaveLength(1);
    expect(row.components[0]?.style).toBe(ButtonStyle.Link);
    expect(row.components[0]?.label).toBe("📤 Share ke WA");
    expect(row.components[0]?.url).toBe("https://wa.me/?text=abc");
  });
});

describe("handleGacha WA share row", () => {
  let mf: Miniflare;
  let env: Env;

  function captureTasks(): { tasks: Promise<unknown>[]; waitUntil: WaitUntil } {
    const tasks: Promise<unknown>[] = [];
    return { tasks, waitUntil: (p) => void tasks.push(p) };
  }

  function slash(
    poolId: string,
    userId: string,
  ): APIChatInputApplicationCommandInteraction {
    return {
      type: InteractionType.ApplicationCommand,
      id: "1",
      application_id: "app",
      token: "tok",
      version: 1,
      data: {
        id: "2",
        name: "gacha",
        type: 1,
        options: [{ name: "pool", type: 3, value: poolId }],
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
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
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
      staminaMax: 5,
      regenIntervalSec: 100,
      resetCooldownSec: 3600,
      memberCount: 1,
    });
    await db.insert(groups).values({
      id: "g1",
      poolId: "pejabat",
      name: "Kabinet",
      badge: "KABINET",
      memberCount: 1,
    });
    await db.insert(members).values({
      id: "aa",
      poolId: "pejabat",
      groupId: "g1",
      name: "Aa",
      nameLower: "aa",
      fullName: "Aa Full",
      photoTotal: 1,
    });
    await db.insert(cards).values({
      id: "aa-01",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "aa",
      serial: 1,
      photoNo: 1,
      rarity: "common",
      imageFile: "aa-01.x.webp",
      enabled: true,
    });
  }, 60_000);

  afterAll(async () => {
    await mf.dispose();
  });

  it("appends a wa.me Link button carrying the card image URL", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { tasks, waitUntil } = captureTasks();
      const res = handleGacha(slash("pejabat", "111"), env, waitUntil);
      expect(res).toEqual({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      });
      await tasks[0];
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = calls[0]?.body as {
        components?: { components?: { url?: string; label?: string }[] }[];
      };
      const shareUrl = body.components?.[1]?.components?.[0]?.url ?? "";
      expect(shareUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
      const decoded = decodeURIComponent(
        shareUrl.replace(/^https:\/\/wa\.me\/\?text=/, ""),
      );
      expect(decoded).toContain("Foto");
      expect(decoded).toContain("No.");
      expect(decoded).toContain("/cards/aa-01.x.webp");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
