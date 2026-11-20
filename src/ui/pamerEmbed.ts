import type { APIEmbed } from "discord-api-types/v10";
import { cardDisplayName } from "../domain/gacha.js";
import { PAMER_TITLE_PREFIX } from "../domain/pamer.js";
import {
  RARITY_COLOR,
  RARITY_LABEL,
  RARITY_STARS,
  type RarityKey,
} from "../domain/rarity.js";
import { cardImageUrl } from "./gachaEmbed.js";

export interface PamerEmbedArgs {
  userId: string;
  memberName: string;
  photoLabel: string | null;
  fullName: string | null;
  poolName: string;
  poolEmoji: string;
  groupName: string;
  groupBadge: string;
  photoNo: number;
  photoTotal: number;
  serial: number;
  rarity: RarityKey;
  quantity: number;
  caption: string | null;
  hype: string;
  imageUrl: string;
}

export function buildPamerEmbed(args: PamerEmbedArgs): APIEmbed {
  const stars = RARITY_STARS[args.rarity];
  const label = RARITY_LABEL[args.rarity];
  const displayName = cardDisplayName(args.photoLabel, args.memberName);
  const nameLine = args.photoLabel ?? args.fullName ?? args.memberName;
  const description = [
    `**${args.hype}**`,
    `<@${args.userId}> memamerkan photocard ${args.poolName} ${args.poolEmoji} ${stars} **${label}**!`,
    `${args.groupName} · ${nameLine} · 📸 Foto ${args.photoNo}/${args.photoTotal}`,
    `💎 No. ${args.serial} · Punya ×${args.quantity}`,
  ];
  if (args.caption !== null) description.push(`💬 “${args.caption}”`);
  return {
    title: `${PAMER_TITLE_PREFIX[args.rarity]}: ${displayName} (${args.groupName})`,
    description: description.join("\n"),
    color: RARITY_COLOR[args.rarity],
    image: { url: args.imageUrl },
    footer: { text: `💎 ${args.poolName} · ${args.groupName}` },
  };
}

export { cardImageUrl };
