import { describe, expect, it } from "vitest";
import {
  HOLO_CHANCE,
  RARITY_KEYS,
  RARITY_LABEL,
  RARITY_STARS,
  RARITY_WEIGHTS,
  pickIndex,
  pickRarity,
  rollHolo,
  type RarityKey,
} from "../src/domain/rarity.js";
import { pullKind, pullLabel } from "../src/domain/gacha.js";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FULL: readonly RarityKey[] = RARITY_KEYS;

describe("pickRarity distribution", () => {
  it("exposes 6-star Secret metadata and 10k-scaled tier weights", () => {
    expect(RARITY_KEYS).toContain("holo");
    expect(RARITY_KEYS).toContain("secret");
    expect(RARITY_STARS.holo).toBe("★★★★★");
    expect(RARITY_LABEL.holo).toBe("Holo");
    expect(RARITY_STARS.secret).toBe("★★★★★★");
    expect(RARITY_LABEL.secret).toBe("Secret");
    expect(RARITY_WEIGHTS).toEqual({
      common: 6270,
      rare: 1570,
      super_rare: 1250,
      ultra_rare: 875,
      holo: 25,
      secret: 10,
    });
  });

  it("100k seeded rolls land within ±1pp of every weight", () => {
    const rand = lcg(12345);
    const counts: Record<RarityKey, number> = {
      common: 0,
      rare: 0,
      super_rare: 0,
      ultra_rare: 0,
      holo: 0,
      secret: 0,
    };
    const N = 100_000;
    for (let i = 0; i < N; i += 1) {
      const r = pickRarity(rand(), FULL);
      expect(r).not.toBeNull();
      counts[r as RarityKey] += 1;
    }
    const total = RARITY_KEYS.reduce((s, k) => s + RARITY_WEIGHTS[k], 0);
    for (const key of FULL) {
      const expected = RARITY_WEIGHTS[key] / total;
      const actual = counts[key] / N;
      expect(Math.abs(actual - expected)).toBeLessThan(0.01);
    }
  });

  it("keeps Holo+Secret under 0.5% over 100k rolls", () => {
    const rand = lcg(12345);
    const counts: Record<RarityKey, number> = {
      common: 0,
      rare: 0,
      super_rare: 0,
      ultra_rare: 0,
      holo: 0,
      secret: 0,
    };
    const N = 100_000;
    for (let i = 0; i < N; i += 1) {
      const r = pickRarity(rand(), FULL);
      expect(r).not.toBeNull();
      counts[r as RarityKey] += 1;
    }
    expect((counts.holo + counts.secret) / N).toBeLessThan(0.005);
    expect((counts.holo + counts.secret) / N).toBeGreaterThan(0.001);
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

describe("rollHolo", () => {
  it("never holo for common/rare", () => {
    for (const rarity of ["common", "rare"] as const) {
      expect(rollHolo(rarity, 0, true)).toBe(false);
    }
  });

  it("never holo when the card is not holo-enabled", () => {
    expect(rollHolo("super_rare", 0, false)).toBe(false);
    expect(rollHolo("ultra_rare", 0, false)).toBe(false);
  });

  it("respects the super_rare threshold", () => {
    expect(rollHolo("super_rare", HOLO_CHANCE.super_rare - 0.001, true)).toBe(
      true,
    );
    expect(rollHolo("super_rare", HOLO_CHANCE.super_rare + 0.001, true)).toBe(
      false,
    );
  });

  it("respects the ultra_rare threshold", () => {
    expect(rollHolo("ultra_rare", HOLO_CHANCE.ultra_rare - 0.001, true)).toBe(
      true,
    );
    expect(rollHolo("ultra_rare", HOLO_CHANCE.ultra_rare + 0.001, true)).toBe(
      false,
    );
  });
});

describe("pullLabel holo", () => {
  it("prefixes holo pulls with ✦ HOLO", () => {
    expect(pullLabel("new-member", 1, true)).toBe("✦ HOLO ✨ Kartu baru!");
    expect(pullLabel("duplicate", 2, true)).toBe("✦ HOLO 🔁 Duplikat ×2");
    expect(pullLabel("new-photo", 1)).toBe("🆕 Foto baru!");
  });
});
