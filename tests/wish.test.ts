import { describe, expect, it } from "vitest";
import {
  isWishable,
  nextWishPity,
  rollWishPity,
  WISH_PITY_AT,
} from "../src/domain/wish.js";

function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

describe("isWishable", () => {
  it("allows every rarity up to holo, never secret", () => {
    expect(isWishable("common")).toBe(true);
    expect(isWishable("holo")).toBe(true);
    expect(isWishable("secret")).toBe(false);
  });
});

describe("rollWishPity", () => {
  it("does nothing before the 50th roll", () => {
    const rand = scripted([0]);
    expect(rollWishPity(WISH_PITY_AT - 2, ["a"], rand)).toBeNull();
  });

  it("does nothing without wishes", () => {
    expect(rollWishPity(WISH_PITY_AT - 1, [], scripted([0, 0]))).toBeNull();
  });

  it("on the 50th roll picks a random wish and hits under 30%", () => {
    // 0.6 -> index 1 of 2 ("b"); 0.29 < 0.3 -> hit.
    expect(rollWishPity(WISH_PITY_AT - 1, ["a", "b"], scripted([0.6, 0.29]))).toBe("b");
  });

  it("on the 50th roll misses at or above 30%", () => {
    expect(rollWishPity(WISH_PITY_AT - 1, ["a", "b"], scripted([0, 0.3]))).toBeNull();
  });
});

describe("nextWishPity", () => {
  it("stays put when the pool has no wishes", () => {
    expect(nextWishPity(7, false, false)).toBe(7);
  });
  it("increments on a miss before the 50th roll", () => {
    expect(nextWishPity(20, true, false)).toBe(21);
  });
  it("resets when a wish is obtained early", () => {
    expect(nextWishPity(20, true, true)).toBe(0);
  });
  it("resets after the 50th roll whatever the outcome", () => {
    expect(nextWishPity(WISH_PITY_AT - 1, true, false)).toBe(0);
  });
});
