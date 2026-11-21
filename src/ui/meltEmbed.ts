import type { APIEmbed } from "discord-api-types/v10";
import { RARITY_COLOR, RARITY_STARS, type RarityKey } from "../domain/rarity.js";

export interface MeltEmbedArgs {
  userId: string;
  memberName: string;
  photoNo: number;
  photoLabel: string | null;
  rarity: RarityKey;
  gained: number;
  poolEmoji: string;
  poolName: string;
  points: number;
}

export function buildMeltEmbed(args: MeltEmbedArgs): APIEmbed {
  const stars = RARITY_STARS[args.rarity] ?? args.rarity;
  const label =
    args.photoLabel !== null && args.photoLabel !== ""
      ? ` · ${args.photoLabel}`
      : "";
  return {
    title: "🔥 Dismantle",
    description:
      `<@${args.userId}> melebur ${stars} ${args.memberName} · Foto ${args.photoNo}` +
      `${label} (+${args.gained} poin) → ${args.poolEmoji} ${args.poolName} (saldo ${args.points})`,
    color: RARITY_COLOR[args.rarity] ?? 0x38bdf8,
    footer: { text: "Copy terakhir tidak bisa dilebur." },
  };
}

export function redeemResultText(args: {
  userId: string;
  cost: number;
  stamina: number;
  poolEmoji: string;
  poolName: string;
  pointsLeft: number;
  staminaTotal: number;
}): string {
  return (
    `⚡ <@${args.userId}> menukar ${args.cost} poin → +${args.stamina} stamina ` +
    `${args.poolEmoji} ${args.poolName} (sisa poin ${args.pointsLeft}, stamina ${args.staminaTotal})`
  );
}
