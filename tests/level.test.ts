import { describe, expect, it, vi } from "vitest";
import { InteractionType, type APIInteraction } from "discord-api-types/v10";
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
  formatSleekProgressBar,
  gachaPullExp,
  getLevelProgress,
  getLevelTier,
  totalExpForLevel,
} from "../src/domain/level.js";
import {
  buildDiscordAvatarUrl,
  extractInteractionUserProfile,
  resolveDiscordUserProfile,
} from "../src/discord/rest.js";
import { buildLevelUpEmbed } from "../src/ui/levelUpEmbed.js";

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

    expect(formatSleekProgressBar(0, 100, 10)).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(formatSleekProgressBar(50, 100, 10)).toBe("▰▰▰▰▰▱▱▱▱▱");
    expect(formatSleekProgressBar(100, 100, 10)).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("maps level brackets to escalating rank tiers", () => {
    expect(getLevelTier(0).title).toBe("Newcomer");
    expect(getLevelTier(1).title).toBe("Newcomer");
    expect(getLevelTier(4).title).toBe("Newcomer");
    expect(getLevelTier(5).title).toBe("Collector");
    expect(getLevelTier(10).title).toBe("Enthusiast");
    expect(getLevelTier(20).title).toBe("Master");
    expect(getLevelTier(35).title).toBe("Grandmaster");
    expect(getLevelTier(50).title).toBe("Legend");
    expect(getLevelTier(122).title).toBe("Legend");
  });
});

describe("level-up notification embed UI kit", () => {
  it("renders dedicated level-up card with avatar thumbnail, transition pill, and stat fields", () => {
    const exp = applyExpGain(80, 50); // Lv 1 -> Lv 2 (130 total, 30/200)
    const embed = buildLevelUpEmbed({
      user: {
        userId: "111",
        displayName: "Dr. John",
        avatarUrl: "https://cdn.discordapp.com/avatars/111/abc.png?size=256",
      },
      exp,
      source: "gacha",
      nowSec: 1_700_000_000,
    });

    expect(embed.title).toBe("🌟 Level Up!");
    expect(embed.description).toContain("**Dr. John** naik ke **Level 2**!");
    expect(embed.description).toContain("`Lv.1` ━━▶ **`Lv.2`**");
    expect(embed.description).toContain("Newcomer");
    expect(embed.color).toBe(getLevelTier(2).color);
    expect(embed.thumbnail?.url).toBe(
      "https://cdn.discordapp.com/avatars/111/abc.png?size=256",
    );
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields?.[0]?.value).toContain("130 EXP");
    expect(embed.fields?.[0]?.value).toContain("+50");
    expect(embed.fields?.[1]?.name).toContain("Lv.3");
    expect(embed.fields?.[1]?.value).toContain("170 EXP");
    expect(embed.fields?.[2]?.value).toContain("30/200 EXP");
    expect(embed.fields?.[2]?.value).toContain("15%");
    expect(embed.footer?.text).toContain("Tarik Gacha");
    expect(embed.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("highlights multi-level jumps, rank-up milestones, and battle source", () => {
    // Lv 4 (600 EXP) + 400 EXP -> 1000 EXP (Lv 5 Collector)
    const rankUpExp = applyExpGain(950, 400); // 950 (Lv 4) -> 1350 (Lv 5)
    const rankEmbed = buildLevelUpEmbed({
      user: {
        userId: "222",
        displayName: "<@222>",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
      },
      exp: rankUpExp,
      source: "battle",
      nowSec: 1_700_000_100,
    });
    expect(rankEmbed.description).toContain("<@222> naik ke **Level 5**!");
    expect(rankEmbed.description).not.toContain("**<@222>**");
    expect(rankEmbed.description).toContain("Rank baru terbuka");
    expect(rankEmbed.description).toContain("Collector");
    expect(rankEmbed.color).toBe(getLevelTier(5).color);
    expect(rankEmbed.footer?.text).toContain("Battle Taruhan");

    // Secret +400 EXP from 0 jumps Lv 1 -> Lv 3 (+2 Lv)
    const multiExp = applyExpGain(0, RARITY_EXP.secret);
    const multiEmbed = buildLevelUpEmbed({
      user: {
        userId: "333",
        displayName: "Aura",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png",
      },
      exp: multiExp,
      source: "gacha",
    });
    expect(multiEmbed.title).toBe("🌟 Multi Level Up! (+2 Lv)");
    expect(multiEmbed.description).toContain("`Lv.1` ━━▶ **`Lv.3`**");
  });
});

describe("Discord user profile resolution", () => {
  it("builds guild, global, and deterministic default Discord avatar URLs", () => {
    expect(
      buildDiscordAvatarUrl({
        userId: "123456789012345678",
        guildId: "999",
        memberAvatar: "mhash",
        userAvatar: "uhash",
      }),
    ).toBe(
      "https://cdn.discordapp.com/guilds/999/users/123456789012345678/avatars/mhash.png?size=256",
    );
    expect(
      buildDiscordAvatarUrl({
        userId: "123456789012345678",
        userAvatar: "uhash",
      }),
    ).toBe(
      "https://cdn.discordapp.com/avatars/123456789012345678/uhash.png?size=256",
    );
    expect(
      buildDiscordAvatarUrl({
        userId: "123456789012345678",
        discriminator: "0",
      }),
    ).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });

  it("extracts profile directly from interaction and resolves remote users gracefully", async () => {
    const interaction = {
      type: InteractionType.ApplicationCommand,
      id: "1",
      application_id: "app",
      token: "tok",
      version: 1,
      guild_id: "g1",
      member: {
        nick: "Dr. John",
        avatar: "srvhash",
        user: {
          id: "111",
          username: "john",
          global_name: "John Global",
          avatar: "glohash",
          discriminator: "0",
        },
      },
    } as unknown as APIInteraction;

    const extracted = extractInteractionUserProfile(interaction);
    expect(extracted).toEqual({
      userId: "111",
      displayName: "Dr. John",
      avatarUrl:
        "https://cdn.discordapp.com/guilds/g1/users/111/avatars/srvhash.png?size=256",
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/guilds/g1/members/222")) {
        return new Response(
          JSON.stringify({
            nick: "Challenger Nick",
            avatar: null,
            user: {
              id: "222",
              username: "chal",
              global_name: "Chal",
              avatar: "chalhash",
              discriminator: "0",
            },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      // Fast-path for invoker: no network call
      const selfProfile = await resolveDiscordUserProfile({
        userId: "111",
        guildId: "g1",
        botToken: "tok",
        interaction,
      });
      expect(selfProfile.displayName).toBe("Dr. John");
      expect(fetchMock).not.toHaveBeenCalled();

      // Remote lookup for non-invoker
      const otherProfile = await resolveDiscordUserProfile({
        userId: "222",
        guildId: "g1",
        botToken: "tok",
        interaction,
      });
      expect(otherProfile).toEqual({
        userId: "222",
        displayName: "Challenger Nick",
        avatarUrl: "https://cdn.discordapp.com/avatars/222/chalhash.png?size=256",
      });

      // Fallback when REST fails
      const fallbackProfile = await resolveDiscordUserProfile({
        userId: "999",
        guildId: "g1",
        botToken: "tok",
        interaction,
      });
      expect(fallbackProfile.displayName).toBe("<@999>");
      expect(fallbackProfile.avatarUrl).toMatch(
        /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
