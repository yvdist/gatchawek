import { describe, expect, it } from "vitest";
import { RARITY_KEYS } from "../src/domain/rarity.js";
import {
  LEVEL_EXP_STEP,
  RARITY_EXP,
  applyExpGain,
  battleWinExp,
  deriveExpGainFromNewTotal,
  expForRarity,
  expToNextLevel,
  formatProgressBar,
  gachaPullExp,
  getLevelProgress,
  totalExpForLevel,
} from "../src/domain/level.js";

describe("level & EXP domain", () => {
  it("awards strictly higher EXP for higher card rarities", () => {
    for (let i = 1; i < RARITY_KEYS.length; i += 1) {
      const lower = RARITY_KEYS[i - 1];
      const higher = RARITY_KEYS[i];
      if (lower === undefined || higher === undefined) {
        throw new Error("unexpected rarity index");
      }
      expect(RARITY_EXP[higher]).toBeGreaterThan(RARITY_EXP[lower]);
      expect(expForRarity(higher)).toBe(RARITY_EXP[higher]);
      expect(gachaPullExp(higher)).toBe(RARITY_EXP[higher]);
    }
  });

  it("awards EXP on wager battle win based on won card rarity and 0 on casual", () => {
    for (const rarity of RARITY_KEYS) {
      expect(battleWinExp("wager", rarity)).toBe(RARITY_EXP[rarity]);
      expect(battleWinExp("casual", rarity)).toBe(0);
    }
  });

  it("computes cumulative and per-level EXP thresholds accurately", () => {
    expect(totalExpForLevel(0)).toBe(0);
    expect(totalExpForLevel(1)).toBe(0);
    expect(totalExpForLevel(2)).toBe(100);
    expect(totalExpForLevel(3)).toBe(300);
    expect(totalExpForLevel(4)).toBe(600);
    expect(totalExpForLevel(5)).toBe(1000);
    expect(totalExpForLevel(10)).toBe(4500);

    expect(expToNextLevel(1)).toBe(LEVEL_EXP_STEP);
    expect(expToNextLevel(2)).toBe(LEVEL_EXP_STEP * 2);
    expect(expToNextLevel(5)).toBe(LEVEL_EXP_STEP * 5);
  });

  it("resolves exact level progress across level boundaries and invalid inputs", () => {
    expect(getLevelProgress(0)).toEqual({
      level: 1,
      totalExp: 0,
      currentExp: 0,
      nextLevelExp: 100,
      progressPct: 0,
    });
    expect(getLevelProgress(99)).toEqual({
      level: 1,
      totalExp: 99,
      currentExp: 99,
      nextLevelExp: 100,
      progressPct: 99,
    });
    expect(getLevelProgress(100)).toEqual({
      level: 2,
      totalExp: 100,
      currentExp: 0,
      nextLevelExp: 200,
      progressPct: 0,
    });
    expect(getLevelProgress(299)).toEqual({
      level: 2,
      totalExp: 299,
      currentExp: 199,
      nextLevelExp: 200,
      progressPct: 99,
    });
    expect(getLevelProgress(300)).toEqual({
      level: 3,
      totalExp: 300,
      currentExp: 0,
      nextLevelExp: 300,
      progressPct: 0,
    });
    expect(getLevelProgress(-50)).toEqual(getLevelProgress(0));
    expect(getLevelProgress(Number.NaN)).toEqual(getLevelProgress(0));

    // Exact boundary check for high levels (floating-point safety).
    for (const lv of [1, 2, 10, 25, 50, 100]) {
      const exact = totalExpForLevel(lv);
      const prog = getLevelProgress(exact);
      expect(prog.level).toBe(lv);
      expect(prog.currentExp).toBe(0);
      if (lv > 1) {
        expect(getLevelProgress(exact - 1).level).toBe(lv - 1);
      }
    }
  });

  it("detects single and multi-level ups cleanly", () => {
    const noUp = applyExpGain(20, 50);
    expect(noUp.leveledUp).toBe(false);
    expect(noUp.previousLevel).toBe(1);
    expect(noUp.currentLevel).toBe(1);
    expect(noUp.progress.totalExp).toBe(70);

    const singleUp = applyExpGain(80, 50);
    expect(singleUp.leveledUp).toBe(true);
    expect(singleUp.previousLevel).toBe(1);
    expect(singleUp.currentLevel).toBe(2);
    expect(singleUp.progress.currentExp).toBe(30);
    expect(singleUp.progress.nextLevelExp).toBe(200);

    // Secret card (+400 EXP) from 0 jumps Lv 1 -> Lv 3 (100 + 200 = 300, +100 into Lv 3).
    const multiUp = applyExpGain(0, RARITY_EXP.secret);
    expect(multiUp.leveledUp).toBe(true);
    expect(multiUp.previousLevel).toBe(1);
    expect(multiUp.currentLevel).toBe(3);
    expect(multiUp.progress.currentExp).toBe(100);
    expect(multiUp.progress.nextLevelExp).toBe(300);

    // Zero EXP gain (e.g. casual battle) never levels up.
    const zeroGain = deriveExpGainFromNewTotal(150, 0);
    expect(zeroGain.gainedExp).toBe(0);
    expect(zeroGain.leveledUp).toBe(false);
    expect(zeroGain.currentLevel).toBe(2);
  });

  it("formats progress bars cleanly within bounds", () => {
    expect(formatProgressBar(0, 100, 10)).toBe("░░░░░░░░░░");
    expect(formatProgressBar(50, 100, 10)).toBe("█████░░░░░");
    expect(formatProgressBar(100, 100, 10)).toBe("██████████");
    expect(formatProgressBar(250, 100, 10)).toBe("██████████");
    expect(formatProgressBar(-10, 100, 10)).toBe("░░░░░░░░░░");
  });
});
