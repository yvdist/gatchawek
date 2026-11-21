import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
  type APIStringSelectComponent,
} from "discord-api-types/v10";
import {
  battleCustomId,
  type BattleCalculationResult,
  type BattleMode,
  type FighterRoll,
} from "../domain/battle.js";
import { cardDisplayName } from "../domain/gacha.js";
import type { ExpGainSummary } from "../domain/level.js";
import {
  RARITY_COLOR,
  RARITY_LABEL,
  RARITY_STARS,
  type RarityKey,
} from "../domain/rarity.js";
import type {
  BattleCardView,
  TargetCardOption,
} from "../db/queries/battle.js";
import { cardImageUrl } from "./gachaEmbed.js";

function modeText(mode: BattleMode): string {
  return mode === "wager"
    ? "🔥 Taruhan Kartu (Pemenang merebut 1 copy kartu lawan + EXP sesuai rarity!)"
    : "🎮 Santai (Kartu aman, tanpa EXP, catat Win/Loss)";
}

export function buildBattlePendingEmbed(args: {
  challengerId: string;
  targetId: string;
  challengerRarity: RarityKey;
  mode: BattleMode;
  expiresAt: number;
}): APIEmbed {
  const stars = RARITY_STARS[args.challengerRarity];
  const label = RARITY_LABEL[args.challengerRarity];
  return {
    title: "⚔️ Tantangan Battle Kartu (Blind Pick)",
    description: [
      `<@${args.challengerId}> menantang <@${args.targetId}>!`,
      `**Mode:** ${modeText(args.mode)}`,
      `🂠 **Kartu <@${args.challengerId}>:** ${stars} **${label}** *(Identitas Kartu Rahasia)*`,
      `⏳ Kedaluwarsa <t:${args.expiresAt}:R>`,
      "",
      `👇 <@${args.targetId}>, pilih kartumu di bawah untuk langsung bertarung!`,
    ].join("\n"),
    color: RARITY_COLOR[args.challengerRarity],
  };
}

export function battlePendingComponents(
  battleId: string,
  targetChoices: TargetCardOption[],
): [
  APIActionRowComponent<APIStringSelectComponent>,
  APIActionRowComponent<APIButtonComponentWithCustomId>,
] {
  const selectRow: APIActionRowComponent<APIStringSelectComponent> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        custom_id: battleCustomId("pick", battleId),
        placeholder: "⚔️ Pilih kartumu untuk langsung bertarung...",
        min_values: 1,
        max_values: 1,
        options: targetChoices.slice(0, 25).map((opt) => ({
          label: opt.label,
          value: opt.id,
          description: opt.description,
        })),
      },
    ],
  };
  const buttonRow: APIActionRowComponent<APIButtonComponentWithCustomId> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        label: "❌ Tolak",
        custom_id: battleCustomId("decline", battleId),
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "🚫 Batal",
        custom_id: battleCustomId("cancel", battleId),
      },
    ],
  };
  return [selectRow, buttonRow];
}

function formatFighterLine(userId: string, card: BattleCardView, roll: FighterRoll): string {
  const displayName = cardDisplayName(card.photoLabel, card.memberName);
  const critTag = roll.isCrit ? ` + 💥 CRIT (${roll.critBonus})` : "";
  return [
    `<@${userId}> · **${displayName}** (${card.groupBadge}) · Foto #${card.photoNo} · ${RARITY_STARS[card.rarity]} ${RARITY_LABEL[card.rarity]}`,
    `⚡ Skor: **${roll.total}** (${roll.base} base + ${roll.dupBonus} dup + ${roll.rng} rng${critTag})`,
  ].join("\n");
}

export function buildBattleResolvedEmbed(args: {
  challengerId: string;
  targetId: string;
  challengerCard: BattleCardView;
  targetCard: BattleCardView;
  calc: BattleCalculationResult;
  mode: BattleMode;
  winnerStats: { wins: number; losses: number };
  winnerExp?: ExpGainSummary;
  baseUrl: string;
}): APIEmbed {
  const winningCard =
    args.calc.winnerId === args.challengerId
      ? args.challengerCard
      : args.targetCard;
  const stolenCard =
    args.calc.winnerId === args.challengerId
      ? args.targetCard
      : args.challengerCard;
  const stolenName = cardDisplayName(
    stolenCard.photoLabel,
    stolenCard.memberName,
  );
  const lines = [
    `**Mode:** ${args.mode === "wager" ? "🔥 Taruhan Kartu" : "🎮 Santai"}`,
    "",
    formatFighterLine(args.challengerId, args.challengerCard, args.calc.challengerRoll),
    "",
    formatFighterLine(args.targetId, args.targetCard, args.calc.targetRoll),
    "",
    `🏆 **Pemenang: <@${args.calc.winnerId}>!**`,
  ];
  if (args.mode === "wager") {
    lines.push(
      `🔥 **Taruhan:** <@${args.calc.winnerId}> merebut 1× **${stolenName}** dari <@${args.calc.loserId}>!`,
    );
    if (args.winnerExp !== undefined && args.winnerExp.gainedExp > 0) {
      lines.push(
        `⭐ **EXP:** <@${args.calc.winnerId}> mendapat **+${args.winnerExp.gainedExp} EXP** (${RARITY_STARS[stolenCard.rarity]} ${RARITY_LABEL[stolenCard.rarity]}) · Lv.${args.winnerExp.currentLevel} (${args.winnerExp.progress.currentExp}/${args.winnerExp.progress.nextLevelExp} EXP)`,
      );
    }
  }
  lines.push(
    `📊 Rekor <@${args.calc.winnerId}>: **${args.winnerStats.wins}W - ${args.winnerStats.losses}L**`,
  );
  const embed: APIEmbed = {
    title: "⚔️ Hasil Battle Kartu",
    description: lines.join("\n"),
    color: RARITY_COLOR[winningCard.rarity],
  };
  if (winningCard.imageFile !== "") {
    embed.thumbnail = { url: cardImageUrl(args.baseUrl, winningCard.imageFile) };
  }
  return embed;
}

export function buildBattleClosedEmbed(args: {
  challengerId: string;
  targetId: string;
  mode: BattleMode;
  status: "declined" | "cancelled" | "expired" | "failed";
}): APIEmbed {
  const statusLine =
    args.status === "declined"
      ? `❌ Ditolak oleh <@${args.targetId}>.`
      : args.status === "cancelled"
        ? `🚫 Dibatalkan oleh <@${args.challengerId}>.`
        : args.status === "expired"
          ? "⚠️ Tantangan kedaluwarsa."
          : "⚠️ Gagal: salah satu kartu sudah tidak tersedia.";
  return {
    title: "⚔️ Tantangan Battle Selesai",
    description: [
      `<@${args.challengerId}> vs <@${args.targetId}>`,
      `**Mode:** ${args.mode === "wager" ? "🔥 Taruhan Kartu" : "🎮 Santai"}`,
      statusLine,
    ].join("\n"),
    color: 0x6b7280,
  };
}
