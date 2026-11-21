import type { BattleMode } from "./battle.js";
import type { RarityKey } from "./rarity.js";

/** Pure EXP & level progression rules: no db/discord/Hono imports. */

/**
 * EXP awarded per card rarity tier. Strictly increasing with rarity value.
 * Used both for /gacha pulls and for wager battle wins (based on the won card's rarity).
 */
export const RARITY_EXP: Record<RarityKey, number> = {
  common: 10,
  rare: 25,
  super_rare: 50,
  ultra_rare: 100,
  holo: 200,
  secret: 400,
};

/**
 * Linear per-level step: going from level L to L+1 requires `LEVEL_EXP_STEP * L` EXP.
 * - Lv 1 -> 2: 100 EXP (cumulative 100)
 * - Lv 2 -> 3: 200 EXP (cumulative 300)
 * - Lv 3 -> 4: 300 EXP (cumulative 600)
 */
export const LEVEL_EXP_STEP = 100;

export function expForRarity(rarity: RarityKey): number {
  return RARITY_EXP[rarity];
}

export function gachaPullExp(rarity: RarityKey): number {
  return expForRarity(rarity);
}

/**
 * Wager battle wins award EXP equal to the won opponent card's rarity value.
 * Casual battles award 0 EXP.
 */
export function battleWinExp(
  mode: BattleMode,
  wonCardRarity: RarityKey,
): number {
  if (mode !== "wager") return 0;
  return expForRarity(wonCardRarity);
}

/** Total cumulative EXP needed to reach `level` (Lv 1 starts at 0 EXP). */
export function totalExpForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0;
  const lv = Math.floor(level);
  return (LEVEL_EXP_STEP * (lv - 1) * lv) / 2;
}

/** EXP required within `level` to advance to `level + 1`. */
export function expToNextLevel(level: number): number {
  const lv = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  return LEVEL_EXP_STEP * lv;
}

export interface LevelProgress {
  readonly level: number;
  readonly totalExp: number;
  readonly currentExp: number;
  readonly nextLevelExp: number;
  readonly progressPct: number;
}

export function getLevelProgress(totalExp: number): LevelProgress {
  const safeExp = Number.isFinite(totalExp) ? Math.max(0, Math.floor(totalExp)) : 0;
  let level = Math.max(
    1,
    Math.floor((1 + Math.sqrt(1 + (8 * safeExp) / LEVEL_EXP_STEP)) / 2),
  );
  while (totalExpForLevel(level + 1) <= safeExp) {
    level += 1;
  }
  while (level > 1 && totalExpForLevel(level) > safeExp) {
    level -= 1;
  }
  const floorExp = totalExpForLevel(level);
  const nextLevelExp = expToNextLevel(level);
  const currentExp = safeExp - floorExp;
  const progressPct = Math.min(
    100,
    Math.max(0, Math.floor((currentExp / nextLevelExp) * 100)),
  );
  return {
    level,
    totalExp: safeExp,
    currentExp,
    nextLevelExp,
    progressPct,
  };
}

export interface ExpGainSummary {
  readonly gainedExp: number;
  readonly previousLevel: number;
  readonly currentLevel: number;
  readonly leveledUp: boolean;
  readonly progress: LevelProgress;
}

export function applyExpGain(
  previousTotalExp: number,
  gainedExp: number,
): ExpGainSummary {
  const safePrev = Number.isFinite(previousTotalExp)
    ? Math.max(0, Math.floor(previousTotalExp))
    : 0;
  const safeGain = Number.isFinite(gainedExp)
    ? Math.max(0, Math.floor(gainedExp))
    : 0;
  const before = getLevelProgress(safePrev);
  const after = getLevelProgress(safePrev + safeGain);
  return {
    gainedExp: safeGain,
    previousLevel: before.level,
    currentLevel: after.level,
    leveledUp: after.level > before.level,
    progress: after,
  };
}

/** Derives an ExpGainSummary from the post-commit total EXP stored in D1. */
export function deriveExpGainFromNewTotal(
  newTotalExp: number,
  gainedExp: number,
): ExpGainSummary {
  const safeNew = Number.isFinite(newTotalExp)
    ? Math.max(0, Math.floor(newTotalExp))
    : 0;
  const safeGain = Number.isFinite(gainedExp)
    ? Math.max(0, Math.floor(gainedExp))
    : 0;
  const prevExp = Math.max(0, safeNew - safeGain);
  const before = getLevelProgress(prevExp);
  const after = getLevelProgress(safeNew);
  return {
    gainedExp: safeGain,
    previousLevel: before.level,
    currentLevel: after.level,
    leveledUp: after.level > before.level,
    progress: after,
  };
}

export function formatProgressBar(
  current: number,
  total: number,
  width = 10,
): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const ratio =
    total > 0 && Number.isFinite(current)
      ? Math.min(1, Math.max(0, current / total))
      : 0;
  const filled = Math.round(ratio * safeWidth);
  return "█".repeat(filled) + "░".repeat(safeWidth - filled);
}
