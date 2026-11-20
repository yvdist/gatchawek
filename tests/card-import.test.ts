import { describe, expect, it } from "vitest";
import {
  parseCardFilename,
  parseRarityAlias,
  toTitleCase,
} from "../src/domain/cardImport.js";

describe("parseRarityAlias", () => {
  it("resolves all canonical rarities and shorthand aliases", () => {
    expect(parseRarityAlias("common")).toBe("common");
    expect(parseRarityAlias("c")).toBe("common");
    expect(parseRarityAlias("1")).toBe("common");
    expect(parseRarityAlias("★")).toBe("common");
    expect(parseRarityAlias("bintang 1")).toBe("common");

    expect(parseRarityAlias("rare")).toBe("rare");
    expect(parseRarityAlias("r")).toBe("rare");
    expect(parseRarityAlias("2")).toBe("rare");
    expect(parseRarityAlias("★★")).toBe("rare");

    expect(parseRarityAlias("super_rare")).toBe("super_rare");
    expect(parseRarityAlias("super rare")).toBe("super_rare");
    expect(parseRarityAlias("super-rare")).toBe("super_rare");
    expect(parseRarityAlias("sr")).toBe("super_rare");
    expect(parseRarityAlias("3")).toBe("super_rare");

    expect(parseRarityAlias("ultra_rare")).toBe("ultra_rare");
    expect(parseRarityAlias("ultra rare")).toBe("ultra_rare");
    expect(parseRarityAlias("ultra-rare")).toBe("ultra_rare");
    expect(parseRarityAlias("ur")).toBe("ultra_rare");
    expect(parseRarityAlias("4")).toBe("ultra_rare");

    expect(parseRarityAlias("holo")).toBe("holo");
    expect(parseRarityAlias("HOLO")).toBe("holo");
    expect(parseRarityAlias("h")).toBe("holo");
    expect(parseRarityAlias("holographic")).toBe("holo");
    expect(parseRarityAlias("ssr")).toBe("holo");
    expect(parseRarityAlias("5")).toBe("holo");
    expect(parseRarityAlias("★★★★★")).toBe("holo");
    expect(parseRarityAlias("bintang 5")).toBe("holo");

    expect(parseRarityAlias("secret")).toBe("secret");
    expect(parseRarityAlias("SECRET")).toBe("secret");
    expect(parseRarityAlias("s")).toBe("secret");
    expect(parseRarityAlias("scr")).toBe("secret");
    expect(parseRarityAlias("6")).toBe("secret");
    expect(parseRarityAlias("★★★★★★")).toBe("secret");
    expect(parseRarityAlias("******")).toBe("secret");
    expect(parseRarityAlias("bintang 6")).toBe("secret");
    expect(parseRarityAlias("bintang-6")).toBe("secret");
  });

  it("returns null for unknown or empty values", () => {
    expect(parseRarityAlias("")).toBeNull();
    expect(parseRarityAlias("   ")).toBeNull();
    expect(parseRarityAlias("legendary")).toBeNull();
  });
});

describe("toTitleCase", () => {
  it("normalizes separators and title-cases each word", () => {
    expect(toTitleCase("refi kaget")).toBe("Refi Kaget");
    expect(toTitleCase("REFI_KAGET-BANGET")).toBe("Refi Kaget Banget");
    expect(toTitleCase("  ahmad   yani ")).toBe("Ahmad Yani");
    expect(toTitleCase("   ")).toBe("");
  });
});

describe("parseCardFilename", () => {
  it("parses the primary example (holo) - refi kaget.jpg", () => {
    expect(parseCardFilename("(holo) - refi kaget.jpg")).toEqual({
      originalFilename: "(holo) - refi kaget.jpg",
      nama: "Refi Kaget",
      memberId: "refi-kaget",
      rarity: "holo",
      rawRarity: "holo",
      group: null,
      rawGroup: null,
      templateMatched: true,
    });
  });

  it("supports bracket variants, whitespace, and path prefixes", () => {
    expect(parseCardFilename("[SR] - budi_santoso.png")).toEqual({
      originalFilename: "[SR] - budi_santoso.png",
      nama: "Budi Santoso",
      memberId: "budi-santoso",
      rarity: "super_rare",
      rawRarity: "SR",
      group: null,
      rawGroup: null,
      templateMatched: true,
    });
    expect(parseCardFilename("C:\\fakepath\\(ultra rare)-ani wijaya.webp")).toEqual({
      originalFilename: "C:\\fakepath\\(ultra rare)-ani wijaya.webp",
      nama: "Ani Wijaya",
      memberId: "ani-wijaya",
      rarity: "ultra_rare",
      rawRarity: "ultra rare",
      group: null,
      rawGroup: null,
      templateMatched: true,
    });
    expect(parseCardFilename("cards/(r) joko.jpeg")).toEqual({
      originalFilename: "cards/(r) joko.jpeg",
      nama: "Joko",
      memberId: "joko",
      rarity: "rare",
      rawRarity: "r",
      group: null,
      rawGroup: null,
      templateMatched: true,
    });
  });

  it("falls back gracefully when template is missing or rarity is unknown", () => {
    expect(parseCardFilename("refi_kaget.jpg")).toEqual({
      originalFilename: "refi_kaget.jpg",
      nama: "Refi Kaget",
      memberId: "refi-kaget",
      rarity: null,
      rawRarity: null,
      group: null,
      rawGroup: null,
      templateMatched: false,
    });
    expect(parseCardFilename("(mythic) - refi kaget.jpg")).toEqual({
      originalFilename: "(mythic) - refi kaget.jpg",
      nama: "Refi Kaget",
      memberId: "refi-kaget",
      rarity: null,
      rawRarity: "mythic",
      group: null,
      rawGroup: null,
      templateMatched: false,
    });
  });

  it("parses the 3-segment form with secret rarity and group", () => {
    expect(parseCardFilename("(secret) - Jomok - Refi Kaget.jpg")).toEqual({
      originalFilename: "(secret) - Jomok - Refi Kaget.jpg",
      nama: "Refi Kaget",
      memberId: "refi-kaget",
      rarity: "secret",
      rawRarity: "secret",
      group: "Jomok",
      rawGroup: "Jomok",
      templateMatched: true,
    });
  });

  it("treats legacy 2-segment holo names as group-less", () => {
    expect(parseCardFilename("(holo) - refi kaget.jpg")).toEqual({
      originalFilename: "(holo) - refi kaget.jpg",
      nama: "Refi Kaget",
      memberId: "refi-kaget",
      rarity: "holo",
      rawRarity: "holo",
      group: null,
      rawGroup: null,
      templateMatched: true,
    });
  });

  it("keeps dashed slugs intact when splitting group and name", () => {
    expect(parseCardFilename("(r) - kabinet-merah-putih - ani.jpg")).toEqual({
      originalFilename: "(r) - kabinet-merah-putih - ani.jpg",
      nama: "Ani",
      memberId: "ani",
      rarity: "rare",
      rawRarity: "r",
      group: "Kabinet Merah Putih",
      rawGroup: "kabinet-merah-putih",
      templateMatched: true,
    });
  });

  it("rejoins multi-dash card names with ' - '", () => {
    expect(parseCardFilename("(c) - Jomok - Ani - Edisi Spesial.jpg")).toEqual({
      originalFilename: "(c) - Jomok - Ani - Edisi Spesial.jpg",
      nama: "Ani Edisi Spesial",
      memberId: "ani-edisi-spesial",
      rarity: "common",
      rawRarity: "c",
      group: "Jomok",
      rawGroup: "Jomok",
      templateMatched: true,
    });
  });
});
