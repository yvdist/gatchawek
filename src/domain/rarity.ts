export const RARITY_KEYS = [
  "common",
  "rare",
  "super_rare",
  "ultra_rare",
  "holo",
  "secret",
] as const;

export type RarityKey = (typeof RARITY_KEYS)[number];

export const RARITY_WEIGHTS: Record<RarityKey, number> = {
  common: 300,
  rare: 70,
  super_rare: 20,
  ultra_rare: 7,
  holo: 2,
  secret: 1,
};

export const RARITY_LABEL: Record<RarityKey, string> = {
  common: "Common",
  rare: "Rare",
  super_rare: "Super Rare",
  ultra_rare: "Ultra Rare",
  holo: "Holo",
  secret: "Secret",
};

export const RARITY_COLOR: Record<RarityKey, number> = {
  common: 0x9ca3af,
  rare: 0xa855f7,
  super_rare: 0xf59e0b,
  ultra_rare: 0xec4899,
  holo: 0xffd700,
  secret: 0x22d3ee,
};

export const RARITY_STARS: Record<RarityKey, string> = {
  common: "★",
  rare: "★★",
  super_rare: "★★★",
  ultra_rare: "★★★★",
  holo: "★★★★★",
  secret: "★★★★★★",
};

export const HOLO_CHANCE: Record<
  Extract<RarityKey, "super_rare" | "ultra_rare">,
  number
> = {
  super_rare: 0.08,
  ultra_rare: 0.25,
};

/**
 * Holo roll: true only for top tiers on holo-enabled cards with
 * `roll < HOLO_CHANCE[rarity]`. Pure; no db/discord imports.
 */
export function rollHolo(
  rarity: RarityKey,
  roll: number,
  holoEnabled: boolean,
): boolean {
  if (!holoEnabled) return false;
  const chance =
    rarity === "super_rare"
      ? HOLO_CHANCE.super_rare
      : rarity === "ultra_rare"
        ? HOLO_CHANCE.ultra_rare
        : null;
  if (chance === null) return false;
  return roll < chance;
}

/**
 * Weighted rarity roll. `roll` in [0, 1). Weights are renormalized over the
 * enabled `available` rarities. Returns null when nothing is available.
 */
export function pickRarity(
  roll: number,
  available: readonly RarityKey[],
): RarityKey | null {
  if (available.length === 0) return null;
  let total = 0;
  for (const key of available) total += RARITY_WEIGHTS[key];
  if (total <= 0) return null;
  const threshold = roll * total;
  let cumulative = 0;
  for (const key of RARITY_KEYS) {
    if (!available.includes(key)) continue;
    cumulative += RARITY_WEIGHTS[key];
    if (threshold < cumulative) return key;
  }
  return available[available.length - 1] as RarityKey;
}

/** Uniform index into [0, length). Throws when length <= 0. */
export function pickIndex(roll: number, length: number): number {
  if (length <= 0) throw new RangeError("pickIndex requires length > 0");
  return Math.floor(roll * length);
}
