import { describe, expect, it } from "vitest";
import {
  againButton,
  buildPullEmbed,
  buildStatusEmbed,
  cardImageUrl,
  resetResultText,
} from "../src/ui/gachaEmbed.js";

describe("gachaEmbed", () => {
  it("builds the pull embed per spec 6.5", () => {
    const embed = buildPullEmbed({
      poolName: "Pejabat",
      poolEmoji: "🏛️",
      memberName: "Aa",
      groupName: "Kabinet",
      fullName: "Aa Full",
      photoNo: 3,
      photoTotal: 13,
      rarity: "rare",
      kind: "new-member",
      isHolo: false,
      isFirstClaim: false,
      quantity: 1,
      userId: "111",
      groupOwned: 3,
      groupTotal: 5,
      staminaLeft: 9,
      staminaMax: 10,
      imageUrl: "https://example.test/cards/aa-03.x.webp",
    });
    expect(embed.title).toBe("🎴 Aa (Kabinet)");
    expect(embed.description).toContain("<@111>");
    expect(embed.description).toContain("Foto 3/13");
    expect(embed.description).toContain("✨ Kartu baru!");
    expect(embed.description).toContain("**3/5**");
    expect(embed.color).toBe(0xa855f7);
    expect(embed.image?.url).toBe("https://example.test/cards/aa-03.x.webp");
    expect(embed.footer?.text).toBe("Sisa tarik: 9/10");
  });

  it("labels duplicates with the post-increment quantity", () => {
    const embed = buildPullEmbed({
      poolName: "P",
      poolEmoji: "🏛️",
      memberName: "Aa",
      groupName: "G",
      fullName: null,
      photoNo: 1,
      photoTotal: 1,
      rarity: "common",
      kind: "duplicate",
      isHolo: false,
      isFirstClaim: false,
      quantity: 4,
      userId: "1",
      groupOwned: 1,
      groupTotal: 1,
      staminaLeft: 0,
      staminaMax: 10,
      imageUrl: "https://x/c.webp",
    });
    expect(embed.description).toContain("🔁 Duplikat ×4");
  });

  it("styles holo pulls gold with ✦ and Holographic line", () => {
    const embed = buildPullEmbed({
      poolName: "Pejabat",
      poolEmoji: "🏛️",
      memberName: "Aa",
      groupName: "Kabinet",
      fullName: "Aa Full",
      photoNo: 1,
      photoTotal: 13,
      rarity: "ultra_rare",
      kind: "new-member",
      isHolo: true,
      isFirstClaim: true,
      quantity: 0,
      userId: "111",
      groupOwned: 1,
      groupTotal: 5,
      staminaLeft: 9,
      staminaMax: 10,
      imageUrl: "https://example.test/cards/aa-01.x.webp",
    });
    expect(embed.title).toBe("✦ 🎴 Aa (Kabinet)");
    expect(embed.color).toBe(0xffd700);
    expect(embed.description).toContain("✦ HOLO ✨ Kartu baru!");
    expect(embed.description).toContain("🌍 Orang pertama yang punya Aa!");
    expect(embed.description).toContain("✨ Holographic!");
  });

  it("builds an under-100-char again button custom id", () => {
    const row = againButton("pejabat", "123456789012345678");
    const customId =
      row.components[0]?.custom_id ?? "";
    expect(customId).toBe("gacha:again:pejabat:123456789012345678");
  });

  it("prefixes the worker host for card images", () => {
    expect(cardImageUrl("example.test", "aa-01.ab12cd34.webp")).toBe(
      "https://example.test/cards/aa-01.ab12cd34.webp",
    );
  });

  it("passes through absolute image URLs untouched", () => {
    expect(cardImageUrl("example.test", "https://cdn.discordapp.com/x.png")).toBe(
      "https://cdn.discordapp.com/x.png",
    );
  });

  it("renders status rows and reset texts", () => {
    const embed = buildStatusEmbed(
      [
        {
          pool: {
            id: "pejabat",
            name: "Pejabat",
            emoji: "🏛️",
            staminaMax: 10,
            regenIntervalSec: 1500,
            resetCooldownSec: 10800,
          },
          stamina: 9,
          max: 10,
          nextAt: 12345,
          resetReadyAt: 99999,
          resetReady: false,
          resetDeniedReason: "cooldown",
          owned: 3,
          total: 5,
        },
      ],
      "111",
    );
    expect(embed.description).toContain("9/10");
    expect(embed.description).toContain("<t:12345:R>");
    expect(embed.description).toContain("3/5 member");

    expect(
      resetResultText("🏛️", "Pejabat", 10, { status: "ok" }),
    ).toContain("10/10");
    expect(
      resetResultText("🏛️", "Pejabat", 10, {
        status: "denied",
        reason: "full",
        readyAt: 1,
      }),
    ).toContain("masih penuh");
    expect(
      resetResultText("🏛️", "Pejabat", 10, {
        status: "denied",
        reason: "cooldown",
        readyAt: 777,
      }),
    ).toContain("<t:777:R>");
  });

  it("renders EXP gain and LEVEL UP banner in pull embed and level bar in status embed", () => {
    const pullEmbed = buildPullEmbed({
      poolName: "Pejabat",
      poolEmoji: "🏛️",
      memberName: "Aa",
      photoLabel: null,
      groupName: "Kabinet",
      fullName: "Aa Full",
      photoNo: 1,
      photoTotal: 5,
      rarity: "super_rare",
      kind: "new-member",
      isHolo: false,
      isFirstClaim: false,
      quantity: 1,
      userId: "111",
      groupOwned: 1,
      groupTotal: 5,
      staminaLeft: 4,
      staminaMax: 10,
      imageUrl: "https://example.test/cards/aa-01.webp",
      exp: {
        gainedExp: 50,
        previousLevel: 1,
        currentLevel: 2,
        leveledUp: true,
        progress: {
          level: 2,
          totalExp: 120,
          currentExp: 20,
          nextLevelExp: 200,
          progressPct: 10,
        },
      },
    });
    expect(pullEmbed.description).toContain("+50 EXP");
    expect(pullEmbed.description).toContain("Lv.2 (20/200 EXP)");
    expect(pullEmbed.description).toContain("LEVEL UP!");
    expect(pullEmbed.description).toContain("Lv.1 → **Lv.2**");

    const statusEmbed = buildStatusEmbed(
      [
        {
          pool: {
            id: "pejabat",
            name: "Pejabat",
            emoji: "🏛️",
            staminaMax: 10,
            regenIntervalSec: 1500,
            resetCooldownSec: 10800,
          },
          stamina: 10,
          max: 10,
          nextAt: null,
          resetReadyAt: 0,
          resetReady: false,
          resetDeniedReason: "full",
          owned: 2,
          total: 5,
        },
      ],
      "111",
      350,
    );
    expect(statusEmbed.description).toContain("Level 3");
    expect(statusEmbed.description).toContain("350 EXP");
    expect(statusEmbed.description).toContain("50/300 ke Lv.4");
  });
});
