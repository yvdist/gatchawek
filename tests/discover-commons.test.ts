import { describe, expect, it } from "vitest";
import {
  assignRarities,
  fnv1a32,
  licenseAllowed,
  scorePhoto,
  slugifyMemberId,
  stripArtistHtml,
} from "../scripts/lib/discover-commons.js";

describe("slugifyMemberId", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyMemberId("Prabowo Subianto", new Set())).toBe(
      "prabowo-subianto",
    );
  });

  it("strips non-alphanumeric runs and trims hyphens", () => {
    expect(slugifyMemberId("  Sjafrie  Sjamsoeddin! ", new Set())).toBe(
      "sjafrie-sjamsoeddin",
    );
  });

  it("caps at 30 chars without trailing hyphen", () => {
    const id = slugifyMemberId(
      "Abdul Muhaimin Iskandar bin Something Long",
      new Set(),
    );
    expect(id.length).toBeLessThanOrEqual(30);
    expect(id).not.toMatch(/-$/);
  });

  it("falls back to member for empty input", () => {
    expect(slugifyMemberId("!!!", new Set())).toBe("member");
  });

  it("suffixes collisions incrementally", () => {
    const taken = new Set(["prabowo", "prabowo-2"]);
    expect(slugifyMemberId("Prabowo", taken)).toBe("prabowo-3");
  });
});

describe("licenseAllowed", () => {
  it.each([
    "CC BY-SA 4.0",
    "CC BY 3.0",
    "CC0",
    "Public domain",
    "PD-old",
    "PD-US",
  ])("allows %s", (license) => {
    expect(licenseAllowed(license)).toBe(license);
  });

  it("rejects non-standard hyphenated CC-BY form (fail-closed)", () => {
    expect(licenseAllowed("CC-BY-4.0")).toBeNull();
  });

  it.each([null, undefined, "", "   ", "Copyrighted", "Fair use", "GFDL", "GFDL-1.2"])(
    "rejects %s",
    (license) => {
      expect(licenseAllowed(license)).toBeNull();
    },
  );

  it("trims whitespace before returning", () => {
    expect(licenseAllowed("  CC BY 4.0  ")).toBe("CC BY 4.0");
  });
});

describe("stripArtistHtml", () => {
  it("strips tags and decodes entities", () => {
    expect(
      stripArtistHtml('<a href="https://x">John &amp; Doe</a>'),
    ).toBe("John & Doe");
  });

  it("collapses whitespace", () => {
    expect(stripArtistHtml("  a   <b>b</b>\nc  ")).toBe("a b c");
  });

  it("returns null for empty markup", () => {
    expect(stripArtistHtml("<br>")).toBeNull();
    expect(stripArtistHtml("")).toBeNull();
  });
});

describe("scorePhoto", () => {
  it("ranks a small portrait above a large landscape", () => {
    expect(scorePhoto(700, 900)).toBeGreaterThan(scorePhoto(4000, 3000));
  });

  it("breaks ties by area within the same orientation", () => {
    expect(scorePhoto(800, 1000)).toBeGreaterThan(scorePhoto(700, 900));
    expect(scorePhoto(2000, 1000)).toBeGreaterThan(scorePhoto(1000, 800));
  });
});

describe("assignRarities", () => {
  const photos = [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }];

  it("is pure and deterministic", () => {
    expect(assignRarities("prabowo", photos)).toEqual(
      assignRarities("prabowo", photos),
    );
  });

  it("gives rank1 ultra iff fnv1a32(memberId) % 4 === 0", () => {
    const ids = ["prabowo", "gibran", "bahlil", "sjafrie", "tito", "yusril"];
    for (const id of ids) {
      const [first] = assignRarities(id, photos);
      expect(first?.rarity).toBe(
        fnv1a32(id) % 4 === 0 ? "ultra_rare" : "super_rare",
      );
    }
  });

  it("maps n=4 ranks to super/ultra, rare, common, common", () => {
    const ultraId =
      ["a", "b", "c", "d", "e", "f", "g", "h"].find(
        (id) => fnv1a32(id) % 4 === 0,
      ) ?? "fallback-for-type";
    const ultra = assignRarities(ultraId, photos);
    expect(ultra.map((p) => p.rarity)).toEqual([
      "ultra_rare",
      "rare",
      "common",
      "common",
    ]);
    const commonId = "zz-non-ultra-check";
    const top = assignRarities(commonId, photos)[0]?.rarity;
    expect(top).toBe(
      fnv1a32(commonId) % 4 === 0 ? "ultra_rare" : "super_rare",
    );
    const rest = assignRarities(commonId, photos).slice(1);
    expect(rest.map((p) => p.rarity)).toEqual(["rare", "common", "common"]);
  });

  it("gives rank3 rare when n >= 5", () => {
    const five = assignRarities("some-member", [
      ...photos,
      { title: "e" },
      { title: "f" },
    ]);
    expect(five.map((p) => p.rarity)).toEqual([
      five[0]?.rarity,
      "rare",
      "rare",
      "common",
      "common",
      "common",
    ]);
  });
});
