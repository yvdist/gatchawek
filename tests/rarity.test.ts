import { describe, expect, it } from "vitest";
import {
  RARITY_KEYS,
  RARITY_WEIGHTS,
  pickIndex,
  pickRarity,
  type RarityKey,
} from "../src/domain/rarity.js";
import {
  pullKind,
  pullLabel,
} from "../src/domain/gacha.js";

/** Deterministic LCG in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FULL: readonly RarityKey[] = RARITY_KEYS;

describe("pickRarity distribution", () => {
  it("100k seeded rolls land within ±1pp of every weight", () => {
    const rand = lcg(12345);
    const counts: Record<RarityKey, number> = {
      common: 0,
      rare: 0,
      super_rare: 0,
      ultra_rare: 0,
    };
    const N = 100_000;
    for (let i = 0; i < N; i += 1) {
      const r = pickRarity(rand(), FULL);
      expect(r).not.toBeNull();
      counts[r as RarityKey] += 1;
    }
    const total = RARITY_WEIGHTS.common + RARITY_WEIGHTS.rare + RARITY_WEIGHTS.super_rare + RARITY_WEIGHTS.ultra_rare;
    for (const key of FULL) {
      const expected = RARITY_WEIGHTS[key] / total;
      const actual = counts[key] / N;
      expect(Math.abs(actual - expected)).toBeLessThan(0.01);
    }
  });

  it("renormalizes without ultra_rare and never picks it", () => {
    const rand = lcg(987654321);
    const available = FULL.filter((k) => k !== "ultra_rare");
    const counts: Record<string, number> = { common: 0, rare: 0, super_rare: 0 };
    const N = 100_000;
    for (let i = 0; i < N; i += 1) {
      const r = pickRarity(rand(), available);
      expect(r).not.toBe("ultra_rare");
      counts[r as string] = (counts[r as string] ?? 0) + 1;
    }
    const total = available.reduce((s, k) => s + RARITY_WEIGHTS[k], 0);
    for (const key of available) {
      const expected = RARITY_WEIGHTS[key] / total;
      const actual = (counts[key] ?? 0) / N;
      expect(Math.abs(actual - expected)).toBeLessThan(0.01);
    }
  });

  it("returns null when nothing is available", () => {
    expect(pickRarity(0.5, [])).toBeNull();
  });
});

describe("pickIndex", () => {
  it("covers upper bound length-1", () => {
    expect(pickIndex(0.9999999, 3)).toBe(2);
    expect(pickIndex(0, 5)).toBe(0);
    expect(() => pickIndex(0.5, 0)).toThrow(RangeError);
  });
});

describe("pullKind / pullLabel", () => {
  it("labels new member", () => {
    expect(pullKind(false, false)).toBe("new-member");
    expect(pullLabel("new-member", 1)).toBe("✨ Kartu baru!");
  });

  it("labels new photo of an owned member", () => {
    expect(pullKind(false, true)).toBe("new-photo");
    expect(pullLabel("new-photo", 1)).toBe("🆕 Foto baru!");
  });

  it("labels duplicates with the post-increment quantity", () => {
    expect(pullKind(true, true)).toBe("duplicate");
    expect(pullLabel("duplicate", 3)).toBe("🔁 Duplikat ×3");
  });
});
