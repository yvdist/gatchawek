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
  pageUrl?: string;
}

export function buildWaShareText(card: WaShareCard): string {
  const display = cardDisplayName(card.photoLabel, card.memberName);
  const stars = RARITY_STARS[card.rarity];
  const label = RARITY_LABEL[card.rarity];
  const total = card.photoTotal <= 0 ? "?" : String(card.photoTotal);
  const link = card.pageUrl ?? card.imageUrl;
  return (
    `🎴 ${display} (${card.groupName})\n` +
    `${stars} ${label} · Foto ${card.photoNo}/${total} · No. ${card.serial}\n` +
    `${link}\n` +
    `${card.imageUrl}`
  );
}
export function buildWaShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Origin for links that must resolve on the deployment that answered the
 * request (`Request.url`), so a temporary worker never links back to the
 * primary one. Falls back to the pinned `PUBLIC_BASE_URL` host where no
 * request exists (tests, scheduled tasks).
 *
 * Assets stay on `PUBLIC_BASE_URL` on purpose: the R2 bucket lives on the
 * primary deployment, the pages do not.
 */
export function pageOrigin(
  origin: string | undefined,
  publicBaseUrl: string,
): string {
  const raw = origin === undefined || origin === "" ? publicBaseUrl : origin;
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}
