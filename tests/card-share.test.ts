import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import { cards, groups, members, pools } from "../src/db/schema.js";
import {
  cardShareCrawlerPage,
  cardShareDescription,
  cardSharePage,
  cardShareTitle,
  type SharedCardData,
} from "../src/ui/cardShareHtml.js";
import { buildWaShareText, buildWaShareUrl } from "../src/domain/share.js";
import { getShareableCard } from "../src/db/queries/share.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let db: Db;
let env: Env;

function baseCard(): SharedCardData {
  return {
    cardId: "alik-01",
    memberName: "Alik Cepak Blitar",
    photoLabel: null,
    groupName: "SJW Vegan Sosialis Anarkis",
    photoNo: 1,
    photoTotal: 1,
    serial: 244,
    rarity: "common",
    imageUrl: "https://example.test/cards/alik-01.665ba5d8.webp",
  };
}

const PAGE_URL = "https://example.test/kartu/alik-01";

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
  });
  await db.insert(groups).values({
    id: "g1",
    poolId: "pejabat",
    name: "Kabinet",
    badge: "KABINET",
    memberCount: 1,
  });
  await db.insert(members).values({
    id: "m-alik",
    poolId: "pejabat",
    groupId: "g1",
    name: "Alik Cepak Blitar",
    nameLower: "alik cepak blitar",
    fullName: "Alik Cepak Blitar Full",
    photoTotal: 1,
  });
  await db.insert(cards).values([
    {
      id: "alik-01",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "m-alik",
      serial: 244,
      photoNo: 1,
      rarity: "common",
      imageFile: "alik-01.665ba5d8.webp",
      enabled: true,
    },
    {
      id: "alik-off",
      poolId: "pejabat",
      groupId: "g1",
      memberId: "m-alik",
      serial: 245,
      photoNo: 2,
      rarity: "rare",
      imageFile: "alik-off.665ba5d8.webp",
      enabled: false,
    },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});
describe("cardShare title/description", () => {
  it("names the card and group with rarity, photo and serial", () => {
    expect(cardShareTitle(baseCard())).toBe(
      "🎴 Alik Cepak Blitar (SJW Vegan Sosialis Anarkis)",
    );
    expect(cardShareDescription(baseCard())).toBe(
      "★ Common · Foto 1/1 · No. 244",
    );
  });
});

describe("crawler page", () => {
  it("carries OG tags WhatsApp unfurls on, pointing at the image file", () => {
    const html = cardShareCrawlerPage(baseCard(), PAGE_URL);
    expect(html).toContain(
      `<meta property="og:title" content="🎴 Alik Cepak Blitar (SJW Vegan Sosialis Anarkis)">`,
    );
    expect(html).toContain(
      `<meta property="og:description" content="★ Common · Foto 1/1 · No. 244">`,
    );
    expect(html).toContain(
      `<meta property="og:image" content="https://example.test/cards/alik-01.665ba5d8.webp">`,
    );
    expect(html).toContain(`<meta property="og:url" content="${PAGE_URL}">`);
    expect(html).toContain(
      `<meta name="twitter:card" content="summary_large_image">`,
    );
  });

  it("escapes card text inside OG attributes", () => {
    const evil = baseCard();
    evil.memberName = `"><script>alert(1)</script>`;
    const html = cardShareCrawlerPage(evil, PAGE_URL);
    expect(html).not.toContain(`"><script>`);
    expect(html).toContain(`&quot;&gt;&lt;script&gt;`);
  });
});

describe("human page", () => {
  it("renders the same OG tags plus one framed card, no grid", () => {
    const html = cardSharePage(baseCard(), PAGE_URL);
    expect(html).toContain(`<meta property="og:image"`);
    expect(html).toContain(`class="photocard"`);
    expect(html).toContain(`COMMON`);
    expect(html).not.toContain(`grid-template-columns`);
  });
});

describe("shareable card query", () => {
  it("returns enabled cards, null for disabled or unknown ids", async () => {
    const found = await getShareableCard(db, "alik-01");
    expect(found?.cardId).toBe("alik-01");
    expect(found?.rarity).toBe("common");
    expect(await getShareableCard(db, "alik-off")).toBeNull();
    expect(await getShareableCard(db, "nope")).toBeNull();
  });
});

describe("WA share text", () => {
  it("links the share page first, raw image second", () => {
    const text = buildWaShareText({ ...baseCard(), pageUrl: PAGE_URL });
    const lines = text.split("\n");
    expect(lines[0]).toBe("🎴 Alik Cepak Blitar (SJW Vegan Sosialis Anarkis)");
    expect(lines[1]).toBe("★ Common · Foto 1/1 · No. 244");
    expect(lines[2]).toBe(PAGE_URL);
    expect(lines[3]).toBe("https://example.test/cards/alik-01.665ba5d8.webp");
    const url = buildWaShareUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(
      text,
    );
  });

  it("falls back to the raw image when no page url is given", () => {
    const text = buildWaShareText(baseCard());
    expect(
      text.endsWith("\nhttps://example.test/cards/alik-01.665ba5d8.webp"),
    ).toBe(true);
  });
});
