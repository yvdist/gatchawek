import { describe, expect, it } from "vitest";
import {
  PAMER_CAPTION_MAX,
  PAMER_TITLE_PREFIX,
  pickHype,
  sanitizeCaption,
} from "../src/domain/pamer.js";
import { RARITY_COLOR } from "../src/domain/rarity.js";
import { buildPamerEmbed } from "../src/ui/pamerEmbed.js";

function baseArgs(rarity: "ultra_rare" | "super_rare" | "rare" | "common") {
  return {
    userId: "u1",
    memberName: "Anna",
    photoLabel: "Pose Panggung" as string | null,
    fullName: "Anna Smith" as string | null,
    poolName: "Pejabat",
    poolEmoji: "🏛️",
    groupName: "Serie Satu",
    groupBadge: "SATU",
    photoNo: 2,
    photoTotal: 13,
    serial: 7,
    rarity,
    quantity: 3,
    caption: null as string | null,
    hype: "HYPE",
    imageUrl: "https://example.test/cards/a.webp",
  };
}

describe("pamer domain", () => {
  it("picks hype deterministically at range edges", () => {
    expect(pickHype("ultra_rare", 0)).toContain("BREWEK");
    expect(pickHype("ultra_rare", 0.999)).toContain("MAHKOTA");
    expect(pickHype("common", 0)).toContain("SAYANG");
    expect(pickHype("common", 0.999)).toContain("PD");
  });

  it("sanitizes captions: trim, collapse, cap, empty-to-null", () => {
    expect(sanitizeCaption(null)).toBeNull();
    expect(sanitizeCaption(undefined)).toBeNull();
    expect(sanitizeCaption("   ")).toBeNull();
    expect(sanitizeCaption("  halo   dunia  ")).toBe("halo dunia");
    expect(sanitizeCaption("a\n\tb")).toBe("a b");
    const long = "x".repeat(PAMER_CAPTION_MAX + 20);
    expect(sanitizeCaption(long)?.length).toBe(PAMER_CAPTION_MAX);
  });
});

describe("buildPamerEmbed", () => {
  it("titles with rarity prefix + photo label and colors per rarity", () => {
    const embed = buildPamerEmbed(baseArgs("ultra_rare"));
    expect(embed.title).toBe(
      `${PAMER_TITLE_PREFIX.ultra_rare}: Pose Panggung (Serie Satu)`,
    );
    expect(embed.color).toBe(RARITY_COLOR.ultra_rare);
  });

  it("falls back to member name when photo label is null", () => {
    const embed = buildPamerEmbed({
      ...baseArgs("rare"),
      photoLabel: null,
      fullName: null,
    });
    expect(embed.title).toContain("Anna (Serie Satu)");
    expect(embed.description).toContain("Anna · 📸 Foto 2/13");
  });

  it("renders mention, foto, serial, quantity, caption quote", () => {
    const embed = buildPamerEmbed({
      ...baseArgs("super_rare"),
      caption: "hoki parah",
      hype: "🔥 SUPER RARE NIH BOS 🔥",
    });
    expect(embed.description).toContain("<@u1> memamerkan photocard");
    expect(embed.description).toContain("Foto 2/13");
    expect(embed.description).toContain("💎 No. 7 · Punya ×3");
    expect(embed.description).toContain('💬 “hoki parah”');
    expect(embed.description).toContain("🔥 SUPER RARE NIH BOS 🔥");
    expect(embed.image?.url).toBe("https://example.test/cards/a.webp");
    expect(embed.footer?.text).toBe("💎 Pejabat · Serie Satu");
  });

  it("omits the caption line when caption is null", () => {
    const embed = buildPamerEmbed(baseArgs("common"));
    expect(embed.description).not.toContain("💬");
  });
});
