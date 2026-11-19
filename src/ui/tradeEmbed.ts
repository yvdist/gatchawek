import {
  ButtonStyle,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
} from "discord-api-types/v10";
import { RARITY_LABEL, RARITY_STARS } from "../domain/rarity.js";
import { tradeCustomId } from "../domain/trade.js";
import type { TradeCardView } from "../db/queries/trade.js";

export type TradeEmbedStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "failed"
  | "expired";

export function tradeCardLine(card: TradeCardView): string {
  return `**${card.memberName}** (${card.groupBadge}) · Foto ${card.photoNo} · ${RARITY_STARS[card.rarity]} ${RARITY_LABEL[card.rarity]}`;
}

export function tradeStatusLine(
  status: TradeEmbedStatus,
  targetId: string,
  expiresAt: number,
): string {
  switch (status) {
    case "pending":
      return `⏳ Menunggu <@${targetId}> — kedaluwarsa <t:${expiresAt}:R>`;
    case "accepted":
      return "✅ Berhasil! Kartu sudah bertukar.";
    case "declined":
      return "❌ Ditolak.";
    case "cancelled":
      return "🚫 Dibatalkan.";
    case "expired":
      return "⚠️ Tawaran kedaluwarsa.";
    case "failed":
      return "⚠️ Gagal: kartu sudah tidak tersedia.";
  }
}

export function buildTradeEmbed(args: {
  proposerId: string;
  targetId: string;
  offer: TradeCardView;
  request: TradeCardView;
  status: TradeEmbedStatus;
  expiresAt: number;
}): APIEmbed {
  return {
    title: "🔁 Tukar Kartu",
    description:
      `<@${args.proposerId}> menawarkan ke <@${args.targetId}>\n` +
      `📤 ${tradeCardLine(args.offer)}\n` +
      `📥 ${tradeCardLine(args.request)}\n` +
      tradeStatusLine(args.status, args.targetId, args.expiresAt),
    color: 0xa855f7,
  };
}

export function tradeButtons(
  tradeId: string,
): APIActionRowComponent<APIButtonComponentWithCustomId> {
  const accept: APIButtonComponentWithCustomId = {
    type: 2,
    style: ButtonStyle.Success,
    label: "✅ Terima",
    custom_id: tradeCustomId("accept", tradeId),
  };
  const decline: APIButtonComponentWithCustomId = {
    type: 2,
    style: ButtonStyle.Danger,
    label: "❌ Tolak",
    custom_id: tradeCustomId("decline", tradeId),
  };
  const cancel: APIButtonComponentWithCustomId = {
    type: 2,
    style: ButtonStyle.Secondary,
    label: "🚫 Batal",
    custom_id: tradeCustomId("cancel", tradeId),
  };
  return { type: 1, components: [accept, decline, cancel] };
}
