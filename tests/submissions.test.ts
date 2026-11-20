import { describe, expect, it } from "vitest";
import { parseBulkSubmission, parseSubmission } from "../scripts/lib/submissions.js";

const IMG = {
  url: "https://cdn.discordapp.net/attachments/1/2/foto.png",
  filename: "foto.png",
  contentType: "image/png",
};

const BASE = {
  guildId: "111",
  channelId: "222",
  messageId: "333",
};

const VALID = `[nama] Aynid Morbulet
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] rare
[label] wakil ketua
[sumber] https://commons.wikimedia.org/wiki/File:Contoh.jpg`;

describe("parseSubmission", () => {
  it("accepts a valid template with an image attachment", () => {
    const result = parseSubmission({ content: VALID, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nama).toBe("Aynid Morbulet");
    expect(result.value.memberId).toBe("aynid-morbulet");
    expect(result.value.pool).toBe("pejabat");
    expect(result.value.grup).toBe("kabinet-merah-putih");
    expect(result.value.rarity).toBe("rare");
    expect(result.value.label).toBe("wakil ketua");
    expect(result.value.sumber).toBe(
      "https://commons.wikimedia.org/wiki/File:Contoh.jpg",
    );
    expect(result.value.imageUrl).toBe(IMG.url);
  });

  it("accepts pool meme + grup jomok", () => {
    const content = `[nama] Katak Bijak
[pool] meme
[grup] jomok
[rarity] common`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pool).toBe("meme");
    expect(result.value.grup).toBe("jomok");
  });

  it("accepts a case-insensitive pool", () => {
    const content = `[nama] Aynid Morbulet
[pool] PEJABAT
[grup] kabinet-merah-putih
[rarity] rare`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pool).toBe("pejabat");
  });

  it("rejects an invalid pool value", () => {
    const content = `[nama] Aynid Morbulet
[pool] dewan
[grup] kabinet-merah-putih
[rarity] rare`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('invalid [pool] "dewan": must be pejabat or meme');
  });

  it("rejects a grup that does not match the pool", () => {
    const content = `[nama] Aynid Morbulet
[pool] meme
[grup] kabinet-merah-putih
[rarity] rare`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      'invalid [grup] "kabinet-merah-putih" for pool "meme": must be jomok',
    );
  });

  it("defaults sumber to the message permalink", () => {
    const content = `[nama] Aynid Morbulet
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] super_rare`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sumber).toBe(
      "https://discord.com/channels/111/222/333",
    );
    expect(result.value.label).toBeNull();
  });

  it("accepts uppercase field keys and rarity", () => {
    const content = `[NAMA] Aynid Morbulet
[POOL] pejabat
[GRUP] kabinet-merah-putih
[RARITY] ULTRA_RARE`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rarity).toBe("ultra_rare");
  });

  it("rejects missing required fields", () => {
    const result = parseSubmission({
      content: "[nama] Tanpa Grup",
      attachments: [IMG],
      ...BASE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("missing required field [pool]");
    expect(result.errors).toContain("missing required field [grup]");
    expect(result.errors).toContain("missing required field [rarity]");
  });

  it("rejects an invalid rarity", () => {
    const content = `[nama] Aynid Morbulet
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] legendary`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("[rarity]"))).toBe(true);
  });

  it("rejects a non-image attachment", () => {
    const result = parseSubmission({
      content: VALID,
      attachments: [
        { url: "https://example.com/a.txt", filename: "a.txt", contentType: "text/plain" },
      ],
      ...BASE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("1 image attachment"))).toBe(true);
  });

  it("rejects zero and multiple image attachments", () => {
    const empty = parseSubmission({ content: VALID, attachments: [], ...BASE });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errors.some((e) => e.includes("found 0"))).toBe(true);
    }
    const two = parseSubmission({
      content: VALID,
      attachments: [IMG, { ...IMG, url: "https://cdn.discordapp.net/x.png" }],
      ...BASE,
    });
    expect(two.ok).toBe(false);
    if (!two.ok) {
      expect(two.errors.some((e) => e.includes("found 2"))).toBe(true);
    }
  });

  it("rejects an overlong label and a non-https sumber", () => {
    const content = `[nama] Aynid Morbulet
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] common
[label] ${"x".repeat(61)}
[sumber] http://example.com/foto.jpg`;
    const result = parseSubmission({ content, attachments: [IMG], ...BASE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("[label]"))).toBe(true);
    expect(result.errors.some((e) => e.includes("[sumber]"))).toBe(true);
  });

describe("parseBulkSubmission", () => {
  const JSON_FILE = {
    url: "https://cdn.discordapp.net/attachments/1/2/bulk.json",
    filename: "bulk.json",
    contentType: "application/json",
  };
  const HEADER = `[bulk-json]
[pool] pejabat
[grup] kabinet-merah-putih
[rarity] rare`;

  it("parses one card per JSON row with shared defaults", () => {
    const jsonText = JSON.stringify([
      { nama: "Aynid Morbulet", imageUrl: "https://example.test/a.jpg" },
      { nama: "Katak Bijak", imageUrl: "https://example.test/b.jpg", label: "lucu" },
    ]);
    const result = parseBulkSubmission({
      content: HEADER,
      attachments: [JSON_FILE],
      jsonText,
      ...BASE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cards).toHaveLength(2);
    expect(result.value.cards[0]).toMatchObject({
      nama: "Aynid Morbulet",
      memberId: "aynid-morbulet",
      pool: "pejabat",
      grup: "kabinet-merah-putih",
      rarity: "rare",
      label: null,
      imageUrl: "https://example.test/a.jpg",
    });
    expect(result.value.cards[1]?.label).toBe("lucu");
  });

  it("rejects invalid JSON, non-array, and bad rows", () => {
    const bad = parseBulkSubmission({
      content: HEADER,
      attachments: [JSON_FILE],
      jsonText: "not json{",
      ...BASE,
    });
    expect(bad.ok).toBe(false);
    const nonArray = parseBulkSubmission({
      content: HEADER,
      attachments: [JSON_FILE],
      jsonText: JSON.stringify({ nama: "x" }),
      ...BASE,
    });
    expect(nonArray.ok).toBe(false);
    const badRow = parseBulkSubmission({
      content: HEADER,
      attachments: [JSON_FILE],
      jsonText: JSON.stringify([{ nama: "", imageUrl: "http://x/y.jpg" }]),
      ...BASE,
    });
    expect(badRow.ok).toBe(false);
    if (!badRow.ok) {
      expect(badRow.errors.some((e) => e.includes("row 1"))).toBe(true);
    }
  });

  it("rejects missing template fields and over-limit card counts", () => {
    const noPool = parseBulkSubmission({
      content: "[bulk-json]\n[grup] kabinet-merah-putih\n[rarity] rare",
      attachments: [JSON_FILE],
      jsonText: JSON.stringify([{ nama: "A", imageUrl: "https://example.test/a.jpg" }]),
      ...BASE,
    });
    expect(noPool.ok).toBe(false);
    const tooMany = parseBulkSubmission({
      content: HEADER,
      attachments: [JSON_FILE],
      jsonText: JSON.stringify(
        Array.from({ length: 51 }, (_, n) => ({
          nama: `M ${String(n)}`,
          imageUrl: "https://example.test/a.jpg",
        })),
      ),
      ...BASE,
    });
    expect(tooMany.ok).toBe(false);
  });
});
});
