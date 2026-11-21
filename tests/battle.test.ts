import { describe, expect, it } from "vitest";
import {
  BATTLE_BASE_POWER,
  BATTLE_CRIT_BONUS,
  BATTLE_DUP_CAP,
  MAX_PENDING_BATTLES,
  battleCustomId,
  canActOnBattle,
  computeFighterRoll,
  duplicateBonus,
  parseBattleCustomId,
  parseBattleMode,
  resolveBattleCalculation,
  validateNewBattle,
} from "../src/domain/battle.js";
import {
  battlePendingComponents,
  buildBattleClosedEmbed,
  buildBattlePendingEmbed,
  buildBattleResolvedEmbed,
} from "../src/ui/battleEmbed.js";

describe("battle domain", () => {
  it("parses battle mode defaulting to casual", () => {
    expect(parseBattleMode("wager")).toBe("wager");
    expect(parseBattleMode("casual")).toBe("casual");
    expect(parseBattleMode(null)).toBe("casual");
    expect(parseBattleMode(undefined)).toBe("casual");
  });

  it("validates new battle preconditions", () => {
    const base = {
      challengerId: "u1",
      targetId: "u2",
      targetIsBot: false,
      challengerPending: 0,
      challengerOwnsCard: true,
      cardEnabled: true,
      targetCardCount: 2,
    };
    expect(validateNewBattle(base)).toBeNull();
    expect(validateNewBattle({ ...base, targetId: "u1" })).toBe("self-battle");
    expect(validateNewBattle({ ...base, targetIsBot: true })).toBe("bot-target");
    expect(validateNewBattle({ ...base, cardEnabled: false })).toBe("card-disabled");
    expect(validateNewBattle({ ...base, challengerOwnsCard: false })).toBe("card-not-owned");
    expect(validateNewBattle({ ...base, targetCardCount: 0 })).toBe("target-has-no-cards");
    expect(
      validateNewBattle({ ...base, challengerPending: MAX_PENDING_BATTLES }),
    ).toBe("pending-limit");
  });

  it("computes duplicate bonus with +50 cap", () => {
    expect(duplicateBonus(0)).toBe(0);
    expect(duplicateBonus(1)).toBe(0);
    expect(duplicateBonus(3)).toBe(10);
    expect(duplicateBonus(11)).toBe(50);
    expect(duplicateBonus(25)).toBe(BATTLE_DUP_CAP);
    expect(duplicateBonus(Number.NaN)).toBe(0);
  });

  it("computes fighter roll with and without critical hit", () => {
    const normal = computeFighterRoll({
      rarity: "common",
      quantity: 3,
      rngRoll: 0.5,
      critRoll: 0.5,
    });
    expect(normal).toEqual({
      base: BATTLE_BASE_POWER.common,
      dupBonus: 10,
      rng: 50,
      isCrit: false,
      critBonus: 0,
      total: 160,
    });

    const crit = computeFighterRoll({
      rarity: "rare",
      quantity: 1,
      rngRoll: 0.25,
      critRoll: 0.05,
    });
    expect(crit).toEqual({
      base: BATTLE_BASE_POWER.rare,
      dupBonus: 0,
      rng: 25,
      isCrit: true,
      critBonus: BATTLE_CRIT_BONUS,
      total: 135 + 25 + 55,
    });
  });

  it("resolves higher score winner and breaks ties cleanly", () => {
    const rolls = [0.8, 0.5, 0.1, 0.5];
    let idx = 0;
    const clear = resolveBattleCalculation({
      challengerId: "u1",
      targetId: "u2",
      challenger: { rarity: "ultra_rare", quantity: 1 },
      target: { rarity: "common", quantity: 1 },
      rand: () => rolls[idx++] ?? 0,
    });
    expect(clear.winnerId).toBe("u1");
    expect(clear.loserId).toBe("u2");
    expect(clear.tieBroken).toBe(false);

    // Identical stats + identical rolls -> tie-breaker picks target when rand < 0.5 is false (>= 0.5)
    const tieRolls = [0.4, 0.9, 0.4, 0.9, 0.75];
    let tieIdx = 0;
    const tied = resolveBattleCalculation({
      challengerId: "u1",
      targetId: "u2",
      challenger: { rarity: "common", quantity: 1 },
      target: { rarity: "common", quantity: 1 },
      rand: () => tieRolls[tieIdx++] ?? 0,
    });
    expect(tied.tieBroken).toBe(true);
    expect(tied.winnerId).toBe("u2");
    expect(tied.targetRoll.total).toBe(tied.challengerRoll.total + 1);
  });

  it("parses battle custom ids and enforces actor authorization", () => {
    const id = battleCustomId("pick", "b-123");
    expect(id).toBe("battle:pick:b-123");
    expect(parseBattleCustomId(id)).toEqual({ action: "pick", battleId: "b-123" });
    expect(parseBattleCustomId("battle:decline:b-123")).toEqual({
      action: "decline",
      battleId: "b-123",
    });
    expect(parseBattleCustomId("battle:cancel:b-123")).toEqual({
      action: "cancel",
      battleId: "b-123",
    });
    expect(parseBattleCustomId("trade:accept:b-123")).toBeNull();
    expect(parseBattleCustomId("battle:nope:b-123")).toBeNull();
    expect(parseBattleCustomId("battle:pick:")).toBeNull();

    expect(canActOnBattle("pick", "u2", "u1", "u2")).toBe(true);
    expect(canActOnBattle("pick", "u1", "u1", "u2")).toBe(false);
    expect(canActOnBattle("decline", "u2", "u1", "u2")).toBe(true);
    expect(canActOnBattle("decline", "u3", "u1", "u2")).toBe(false);
    expect(canActOnBattle("cancel", "u1", "u1", "u2")).toBe(true);
    expect(canActOnBattle("cancel", "u2", "u1", "u2")).toBe(false);
    expect(canActOnBattle("pick", null, "u1", "u2")).toBe(false);
  });
});

describe("battleEmbed", () => {
  it("shows only challenger rarity hint in pending embed (no card name leak)", () => {
    const embed = buildBattlePendingEmbed({
      challengerId: "u1",
      targetId: "u2",
      challengerRarity: "ultra_rare",
      mode: "wager",
      expiresAt: 1700000900,
    });
    expect(embed.title).toContain("Blind Pick");
    expect(embed.description).toContain("★★★★ **Ultra Rare**");
    expect(embed.description).toContain("Identitas Kartu Rahasia");
    expect(embed.description).toContain("Taruhan Kartu");

    const rows = battlePendingComponents("b1", [
      { id: "ani-01", label: "★★ Ani (KAB)", description: "Foto #1 · Base 135" },
    ]);
    expect(rows[0].components[0]?.custom_id).toBe("battle:pick:b1");
    expect(rows[1].components[0]?.custom_id).toBe("battle:decline:b1");
    expect(rows[1].components[1]?.custom_id).toBe("battle:cancel:b1");
  });

  it("reveals both cards, scores, wager transfer, and thumbnail on resolve", () => {
    const embed = buildBattleResolvedEmbed({
      challengerId: "u1",
      targetId: "u2",
      challengerCard: {
        cardId: "budi-01",
        memberName: "Budi",
        photoLabel: null,
        groupBadge: "KMP",
        photoNo: 1,
        rarity: "ultra_rare",
        imageFile: "budi.webp",
        quantity: 2,
      },
      targetCard: {
        cardId: "ani-01",
        memberName: "Ani",
        photoLabel: "Pose Kaget",
        groupBadge: "KMP",
        photoNo: 2,
        rarity: "rare",
        imageFile: "ani.webp",
        quantity: 1,
      },
      calc: {
        winnerId: "u1",
        loserId: "u2",
        challengerRoll: {
          base: 220,
          dupBonus: 5,
          rng: 40,
          isCrit: true,
          critBonus: 55,
          total: 320,
        },
        targetRoll: {
          base: 135,
          dupBonus: 0,
          rng: 10,
          isCrit: false,
          critBonus: 0,
          total: 145,
        },
        tieBroken: false,
      },
      mode: "wager",
      winnerStats: { wins: 2, losses: 1 },
      baseUrl: "example.test",
    });
    expect(embed.description).toContain("Budi");
    expect(embed.description).toContain("Pose Kaget");
    expect(embed.description).toContain("320");
    expect(embed.description).toContain("💥 CRIT");
    expect(embed.description).toContain("merebut 1× **Pose Kaget**");
    expect(embed.description).toContain("2W - 1L");
    expect(embed.thumbnail?.url).toBe("https://example.test/cards/budi.webp");
  });

  it("formats closed battle statuses", () => {
    const declined = buildBattleClosedEmbed({
      challengerId: "u1",
      targetId: "u2",
      mode: "casual",
      status: "declined",
    });
    expect(declined.description).toContain("Ditolak");
  });

  it("shows winner EXP & LEVEL UP on wager resolve and omits EXP on casual resolve", () => {
    const baseArgs = {
      challengerId: "u1",
      targetId: "u2",
      challengerCard: {
        cardId: "budi-01",
        memberName: "Budi",
        photoLabel: null,
        groupBadge: "KMP",
        photoNo: 1,
        rarity: "super_rare" as const,
        imageFile: "budi.webp",
        quantity: 1,
      },
      targetCard: {
        cardId: "ani-01",
        memberName: "Ani",
        photoLabel: null,
        groupBadge: "KMP",
        photoNo: 1,
        rarity: "super_rare" as const,
        imageFile: "ani.webp",
        quantity: 1,
      },
      calc: {
        winnerId: "u1",
        loserId: "u2",
        challengerRoll: {
          base: 175,
          dupBonus: 0,
          rng: 80,
          isCrit: false,
          critBonus: 0,
          total: 255,
        },
        targetRoll: {
          base: 175,
          dupBonus: 0,
          rng: 10,
          isCrit: false,
          critBonus: 0,
          total: 185,
        },
        tieBroken: false,
      },
      winnerStats: { wins: 1, losses: 0 },
      baseUrl: "example.test",
    };

    const wagerEmbed = buildBattleResolvedEmbed({
      ...baseArgs,
      mode: "wager",
      winnerExp: {
        gainedExp: 50,
        previousLevel: 1,
        currentLevel: 2,
        leveledUp: true,
        progress: {
          level: 2,
          totalExp: 110,
          currentExp: 10,
          nextLevelExp: 200,
          progressPct: 5,
        },
      },
    });
    expect(wagerEmbed.description).toContain("+50 EXP");
    expect(wagerEmbed.description).toContain("Super Rare");
    expect(wagerEmbed.description).toContain("LEVEL UP!");

    const casualEmbed = buildBattleResolvedEmbed({
      ...baseArgs,
      mode: "casual",
      winnerExp: {
        gainedExp: 0,
        previousLevel: 1,
        currentLevel: 1,
        leveledUp: false,
        progress: {
          level: 1,
          totalExp: 60,
          currentExp: 60,
          nextLevelExp: 100,
          progressPct: 60,
        },
      },
    });
    expect(casualEmbed.description).not.toContain("EXP");
    expect(casualEmbed.description).not.toContain("LEVEL UP!");
  });
});
