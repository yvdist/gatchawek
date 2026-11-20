import { describe, expect, it } from "vitest";
import { parseSubmission } from "../scripts/lib/submissions.js";

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
[grup] kabinet-merah-putih
[rarity] rare
[label] wakil ketua
[sumber] https://commons.wikimedia.org/wiki/File:Contoh.jpg`;

describe("parseSubmission", () => {
  it("accepts a valid template with an image attachment", () => {
    const result = parseSubmission({
      content: VALID,
      attachments: [IMG],
      ...BASE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nama).toBe("Aynid Morbulet");
    expect(result.value.memberId).toBe("aynid-morbulet");
    expect(result.value.grup).toBe("kabinet-merah-putih");
    expect(result.value.rarity).toBe("rare");
    expect(result.value.label).toBe("wakil ketua");
    expect(result.value.sumber).toBe(
      "https://commons.wikimedia.org/wiki/File:Contoh.jpg",
    );
    expect(result.value.imageUrl).toBe(IMG.url);
  });

  it("defaults sumber to the message permalink", () => {
    const content = `[nama] Aynid Morbulet
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
    expect(result.errors).toContain("missing required field [grup]");
    expect(result.errors).toContain("missing required field [rarity]");
  });

  it("rejects an invalid rarity", () => {
    const content = `[nama] Aynid Morbulet
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
});
