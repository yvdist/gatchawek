import {
  ButtonStyle,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
} from "discord-api-types/v10";
import {
  giveCustomId,
  type GiveMode,
  type GiveStatus,
} from "../domain/give.js";
import { RARITY_COLOR, RARITY_STARS } from "../domain/rarity.js";
import { cardDisplayName } from "../domain/gacha.js";
import type { GiveCardView } from "../db/queries/give.js";

export interface GiveEmbedArgs {
  mode: GiveMode;
  giverId: string;
  targetId: string | null;
  claimerId: string | null;
  status: GiveStatus;
  expiresAt: number;
  card: GiveCardView;
  imageUrl: string;
}

function statusLine(args: GiveEmbedArgs): string {
  const { mode, giverId, targetId, claimerId, status, expiresAt } = args;
  const target = targetId ?? giverId;
  switch (status) {
    case "open":
      return mode === "public"
        ? `🎁 <@${giverId}> melepas kartu ini — siapa cepat dia dapat! Kedaluwarsa <t:${expiresAt}:R>.`
        : `⏳ <@${giverId}> menawarkan ke <@${target}> — kedaluwarsa <t:${expiresAt}:R>.`;
    case "claimed": {
      const claimer = claimerId ?? giverId;
      return mode === "public"
        ? `✅ Diambil <@${claimer}>!`
        : `✅ Diterima <@${claimer}>!`;
    }
    case "rejected":
      return `❌ Ditolak <@${target}>.`;
    case "cancelled":
      return "🚫 Dibatalkan pemberi.";
    case "expired":
      return `⌛ Kedaluwarsa — kartu tetap di <@${giverId}>.`;
    case "failed":
      return "⚠️ Gagal: kartu sudah tidak tersedia.";
  }
}

function cardLine(card: GiveCardView): string {
  return (
    `${RARITY_STARS[card.rarity]} **${cardDisplayName(card.photoLabel, card.memberName)}** (${card.groupBadge})` +
    ` · ${card.poolEmoji} ${card.poolName} · Foto ${card.photoNo}/${card.photoTotal} · 💎 No. ${card.serial}`
  );
}

export function buildGiveEmbed(args: GiveEmbedArgs): APIEmbed {
  return {
    title: "🎁 Giveaway Kartu",
    description: `${cardLine(args.card)}\n${statusLine(args)}`,
    color: RARITY_COLOR[args.card.rarity],
    thumbnail: { url: args.imageUrl },
    footer: { text: `💎 ${args.card.poolName} · ${args.card.groupName}` },
  };
}

export function giveButtons(
  mode: GiveMode,
  giveId: string,
): APIActionRowComponent<APIButtonComponentWithCustomId> {
  const cancel: APIButtonComponentWithCustomId = {
    type: 2,
    style: ButtonStyle.Secondary,
    label: "🚫 Batal",
    custom_id: giveCustomId("cancel", giveId),
  };
  if (mode === "public") {
    const claim: APIButtonComponentWithCustomId = {
      type: 2,
      style: ButtonStyle.Success,
      label: "🎁 Ambil",
      custom_id: giveCustomId("claim", giveId),
    };
    return { type: 1, components: [claim, cancel] };
  }
  const accept: APIButtonComponentWithCustomId = {
    type: 2,
    style: ButtonStyle.Success,
    label: "✅ Terima",
    custom_id: giveCustomId("accept", giveId),
  };
  const reject: APIButtonComponentWithCustomId = {
    type: 2,
    style: ButtonStyle.Danger,
    label: "❌ Tolak",
    custom_id: giveCustomId("reject", giveId),
  };
  return { type: 1, components: [accept, reject, cancel] };
}
