import { cardDisplayName } from "./gacha.js";
import { RARITY_LABEL, RARITY_STARS, type RarityKey } from "./rarity.js";

export interface WaShareCard {
  memberName: string;
  photoLabel: string | null;
  groupName: string;
  photoNo: number;
  photoTotal: number;
  serial: number;
  rarity: RarityKey;
  imageUrl: string;
}

export function buildWaShareText(card: WaShareCard): string {
  const display = cardDisplayName(card.photoLabel, card.memberName);
  const stars = RARITY_STARS[card.rarity];
  const label = RARITY_LABEL[card.rarity];
  const total = card.photoTotal <= 0 ? "?" : String(card.photoTotal);
  return (
    `🎴 ${display} (${card.groupName})\n` +
    `${stars} ${label} · Foto ${card.photoNo}/${total} · No. ${card.serial}\n` +
    `${card.imageUrl}`
  );
}

export function buildWaShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
