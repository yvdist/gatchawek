import { censorName } from "./list.js";
import { isHiddenRarity, type RarityKey } from "./rarity.js";

/** One-time album links expire after 15 minutes if left unopened. */
export const ALBUM_TOKEN_TTL_SEC = 900;

/** 6 pockets on left page + 6 pockets on right page = 12 slots per open spread. */
export const ALBUM_SPREAD_SIZE = 12;

const TOKEN_HEX_PATTERN = /^[0-9a-f]{32,64}$/;

const CRAWLER_UA_PATTERN =
  /discordbot|twitterbot|whatsapp|telegrambot|slackbot|facebookexternalhit|linkedinbot|embedly|skypeuripreview|vkshare|pinterest|applebot/i;

export function generateAlbumTokenHex(randomBytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < randomBytes.length; i += 1) {
    out += (randomBytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return out;
}

export function isValidAlbumToken(token: string): boolean {
  return TOKEN_HEX_PATTERN.test(token);
}

export function albumExpiry(nowSec: number): number {
  return nowSec + ALBUM_TOKEN_TTL_SEC;
}

/**
 * Automated link unfurlers (Discord, WhatsApp, Telegram, etc.) must not burn
 * a user's single-use album token when previewing the URL.
 */
export function isLinkPreviewCrawler(
  userAgent: string | null | undefined,
): boolean {
  if (typeof userAgent !== "string" || userAgent === "") return false;
  return CRAWLER_UA_PATTERN.test(userAgent);
}

export function resolveAlbumCardImageUrl(
  base: string,
  imageFile: string,
): string {
  if (imageFile.startsWith("https://") || imageFile.startsWith("http://")) {
    return imageFile;
  }
  const cleanBase = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanBase}/cards/${imageFile}`;
}

export interface RawAlbumCardSlot {
  readonly cardId: string;
  readonly poolId: string;
  readonly groupId: string;
  readonly memberId: string;
  readonly memberName: string;
  readonly fullName: string | null;
  readonly photoLabel: string | null;
  readonly serial: number;
  readonly photoNo: number;
  readonly photoTotal: number;
  readonly rarity: RarityKey;
  readonly holoEnabled: boolean;
  readonly imageFile: string;
  readonly quantity: number;
  readonly holoQty: number;
  readonly firstObtainedAt: number | null;
  readonly lastObtainedAt: number | null;
}

export interface AlbumBinderSlot {
  readonly cardId: string;
  readonly poolId: string;
  readonly groupId: string;
  readonly memberId: string;
  readonly memberName: string;
  readonly fullName: string | null;
  readonly photoLabel: string | null;
  readonly serial: number;
  readonly photoNo: number;
  readonly photoTotal: number;
  readonly rarity: RarityKey;
  readonly holoEnabled: boolean;
  readonly owned: boolean;
  readonly hiddenMystery: boolean;
  readonly quantity: number;
  readonly holoQty: number;
  readonly totalCopies: number;
  readonly imageUrl: string | null;
  readonly firstObtainedAt: number | null;
  readonly lastObtainedAt: number | null;
}

/**
 * Masks unowned card slots so unowned image URLs are never exposed, and
 * unowned Holo/Secret cards have their names censored with asterisks.
 */
export function maskAlbumSlot(
  raw: RawAlbumCardSlot,
  publicBaseUrl: string,
): AlbumBinderSlot {
  const totalCopies = raw.quantity + raw.holoQty;
  const owned = totalCopies > 0;
  const hiddenMystery = !owned && isHiddenRarity(raw.rarity);

  return {
    cardId: raw.cardId,
    poolId: raw.poolId,
    groupId: raw.groupId,
    memberId: raw.memberId,
    memberName: hiddenMystery ? censorName(raw.memberName) : raw.memberName,
    fullName: owned ? raw.fullName : null,
    photoLabel:
      raw.photoLabel === null
        ? null
        : hiddenMystery
          ? censorName(raw.photoLabel)
          : raw.photoLabel,
    serial: raw.serial,
    photoNo: raw.photoNo,
    photoTotal: raw.photoTotal,
    rarity: raw.rarity,
    holoEnabled: raw.holoEnabled,
    owned,
    hiddenMystery,
    quantity: owned ? raw.quantity : 0,
    holoQty: owned ? raw.holoQty : 0,
    totalCopies: owned ? totalCopies : 0,
    imageUrl: owned
      ? resolveAlbumCardImageUrl(publicBaseUrl, raw.imageFile)
      : null,
    firstObtainedAt: owned ? raw.firstObtainedAt : null,
    lastObtainedAt: owned ? raw.lastObtainedAt : null,
  };
}
