import { pickIndex, type RarityKey } from "./rarity.js";

/** Wish pity: the 50th counted roll in a pool boosts one random wish to 30%. */
export const WISH_PITY_AT = 50;
export const WISH_PITY_RATE = 0.3;
export const MAX_WISHES_PER_POOL = 3;

/** Secret stays pure luck: never wishable, never pitied. */
export function isWishable(rarity: RarityKey): boolean {
  return rarity !== "secret";
}

/**
 * Returns the wished card id the pity hands out, or null to roll normally.
 * Draws from `rand` only on the pity roll, so normal pulls keep their RNG.
 */
export function rollWishPity(
  pity: number,
  wishCardIds: readonly string[],
  rand: () => number,
): string | null {
  if (wishCardIds.length === 0 || pity < WISH_PITY_AT - 1) return null;
  const target = wishCardIds[pickIndex(rand(), wishCardIds.length)] ?? null;
  return rand() < WISH_PITY_RATE ? target : null;
}

/** Counter only moves while the pool has wishes; pity roll or a wish hit resets it. */
export function nextWishPity(
  pity: number,
  hasWishes: boolean,
  gotWish: boolean,
): number {
  if (!hasWishes) return pity;
  if (gotWish || pity >= WISH_PITY_AT - 1) return 0;
  return pity + 1;
}
