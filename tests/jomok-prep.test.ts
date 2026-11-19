import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  assignMemberIds,
  detectDividers,
  groupRows,
  rarityFor,
  slugify,
  type OcrRow,
} from "../scripts/lib/jomok-prep.js";

/** 200×400 black canvas with white divider lines at y=220..223 and y=280..283. */
function dividerPixels(): { data: Uint8ClampedArray; w: number; h: number } {
  const w = 200;
  const h = 400;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 220, w, 4);
  ctx.fillRect(0, 280, w, 4);
  const id = ctx.getImageData(0, 0, w, h);
  return { data: id.data, w, h };
}

function row(over: Partial<OcrRow> & { sourceFile: string }): OcrRow {
  return {
    ocrName: "Test",
    confidence: 95,
    hash: `hash-${over.sourceFile}`,
    memberId: "test",
    memberName: "Test",
    needsReview: false,
    reasons: [],
    ...over,
  };
}

describe("detectDividers", () => {
  it("finds both synthetic divider lines exactly", () => {
    const { data, w, h } = dividerPixels();
    const r = detectDividers(data, w, h);
    expect(r.fallback).toBe(false);
    expect(r.photoEnd).toBe(220);
    expect(r.nameEnd).toBe(280);
  });

  it("falls back on a blank image", () => {
    const w = 100;
    const h = 200;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    const r = detectDividers(id.data, w, h);
    expect(r.fallback).toBe(true);
    expect(r.photoEnd).toBe(Math.round(0.56 * h));
  });

  it("ignores thin noise runs under 3px", () => {
    const w = 200;
    const h = 400;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 100, w, 2); // noise, too thin
    ctx.fillRect(0, 220, w, 4);
    ctx.fillRect(0, 280, w, 4);
    const id = ctx.getImageData(0, 0, w, h);
    const r = detectDividers(id.data, w, h);
    expect(r.fallback).toBe(false);
    expect(r.photoEnd).toBe(220);
    expect(r.nameEnd).toBe(280);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Mas Bambang", 0)).toBe("mas-bambang");
  });

  it("strips punctuation and collapses repeats", () => {
    expect(slugify("  Bro!!  Jomok?? ", 0)).toBe("bro-jomok");
  });

  it("truncates to 30 chars", () => {
    expect(slugify("abcdefghijklmnopqrstuvwxyzabcdef", 0)).toBe("abcdefghijklmnopqrstuvwxyzabcd");
    expect(slugify("abcdefghijklmnopqrstuvwxyzabcdef", 0).length).toBeLessThanOrEqual(30);
  });

  it("falls back to unknown-<index> on empty", () => {
    expect(slugify("!!!", 7)).toBe("unknown-7");
  });
});

describe("rarityFor", () => {
  it("maps photo numbers to rarities", () => {
    expect(rarityFor(1)).toBe("common");
    expect(rarityFor(2)).toBe("common");
    expect(rarityFor(3)).toBe("rare");
    expect(rarityFor(4)).toBe("rare");
    expect(rarityFor(5)).toBe("super_rare");
    expect(rarityFor(6)).toBe("ultra_rare");
    expect(rarityFor(12)).toBe("ultra_rare");
  });
});

describe("assignMemberIds", () => {
  it("suffixes slug collisions", () => {
    const rows = assignMemberIds([
      { sourceFile: "a.jpg", ocrName: "Mas Bro", confidence: 90, hash: "h1" },
      { sourceFile: "b.jpg", ocrName: "mas bro!", confidence: 90, hash: "h2" },
      { sourceFile: "c.jpg", ocrName: "MAS BRO", confidence: 90, hash: "h3" },
    ]);
    const ids = rows.map((r) => r.memberId);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("mas-bro");
    expect(rows[1]?.needsReview).toBe(true);
    expect(rows[1]?.reasons).toContain("slug-collision");
  });

  it("flags low confidence", () => {
    const rows = assignMemberIds([{ sourceFile: "a.jpg", ocrName: "X", confidence: 40, hash: "h1" }]);
    expect(rows[0]?.needsReview).toBe(true);
    expect(rows[0]?.reasons).toContain("low-confidence");
  });
});

describe("groupRows", () => {
  it("groups by member, orders by file, dedupes intra-member hashes", () => {
    const groups = groupRows([
      row({ sourceFile: "b.jpg", memberId: "m1", memberName: "M1", hash: "same" }),
      row({ sourceFile: "a.jpg", memberId: "m1", memberName: "M1", hash: "same" }),
      row({ sourceFile: "c.jpg", memberId: "m1", memberName: "M1", hash: "other" }),
    ]);
    const g = groups.get("m1");
    expect(g?.rows.map((r) => r.sourceFile)).toEqual(["a.jpg", "c.jpg"]);
    expect(g?.dupes).toEqual(["b.jpg"]);
  });

  it("flags cross-member dupes on both rows", () => {
    const groups = groupRows([
      row({ sourceFile: "a.jpg", memberId: "m1", memberName: "M1", hash: "shared" }),
      row({ sourceFile: "b.jpg", memberId: "m2", memberName: "M2", hash: "shared" }),
    ]);
    for (const g of groups.values()) {
      for (const r of g.rows) {
        expect(r.needsReview).toBe(true);
        expect(r.reasons).toContain("cross-member-dupe");
      }
    }
  });
});
