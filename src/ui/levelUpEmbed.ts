import type { APIEmbed } from "discord-api-types/v10";
import type { DiscordUserProfile } from "../discord/rest.js";
import {
  formatSleekProgressBar,
  getLevelTier,
  type ExpGainSummary,
} from "../domain/level.js";

export type LevelUpSource = "gacha" | "battle";

export interface LevelUpEmbedArgs {
  readonly user: DiscordUserProfile;
  readonly exp: ExpGainSummary;
  readonly source: LevelUpSource;
  readonly nowSec?: number;
}

const SOURCE_FOOTER: Record<LevelUpSource, string> = {
  gacha: "🎴 Dari Tarik Gacha · Cek /status & /top",
  battle: "⚔️ Dari Battle Taruhan · Cek /status & /top",
};

function formatSubject(user: DiscordUserProfile): string {
  const trimmed = user.displayName.trim();
  if (trimmed === "" || trimmed.startsWith("<@")) {
    return `<@${user.userId}>`;
  }
  return `**${trimmed}**`;
}

export function buildLevelUpEmbed(args: LevelUpEmbedArgs): APIEmbed {
  const { user, exp, source } = args;
  const levelsGained = Math.max(1, exp.currentLevel - exp.previousLevel);
  const currentTier = getLevelTier(exp.currentLevel);
  const previousTier = getLevelTier(exp.previousLevel);
  const remainingExp = Math.max(
    0,
    exp.progress.nextLevelExp - exp.progress.currentExp,
  );
  const progressBar = formatSleekProgressBar(
    exp.progress.currentExp,
    exp.progress.nextLevelExp,
    10,
  );

  const title =
    levelsGained > 1
      ? `🌟 Multi Level Up! (+${levelsGained} Lv)`
      : "🌟 Level Up!";

  const descriptionLines = [
    `${formatSubject(user)} naik ke **Level ${exp.currentLevel}**!`,
    `\`Lv.${exp.previousLevel}\` ━━▶ **\`Lv.${exp.currentLevel}\`** · ${currentTier.badge} **${currentTier.title}**`,
  ];

  if (currentTier.title !== previousTier.title) {
    descriptionLines.push(
      `🏅 Rank baru terbuka: **${currentTier.badge} ${currentTier.title}**!`,
    );
  }

  const timestampMs =
    args.nowSec !== undefined ? args.nowSec * 1000 : Date.now();

  return {
    title,
    description: descriptionLines.join("\n"),
    color: currentTier.color,
    thumbnail: { url: user.avatarUrl },
    fields: [
      {
        name: "⭐ Total EXP",
        value: `**${exp.progress.totalExp} EXP** (+${exp.gainedExp})`,
        inline: true,
      },
      {
        name: `🎯 Menuju Lv.${exp.currentLevel + 1}`,
        value: `**${remainingExp} EXP** lagi`,
        inline: true,
      },
      {
        name: `📊 Progres Lv.${exp.currentLevel} → Lv.${exp.currentLevel + 1}`,
        value: `\`${progressBar}\` **${exp.progress.progressPct}%** · \`${exp.progress.currentExp}/${exp.progress.nextLevelExp} EXP\``,
        inline: false,
      },
    ],
    footer: { text: SOURCE_FOOTER[source] },
    timestamp: new Date(timestampMs).toISOString(),
  };
}
