/** Pure give/give-to validation: no db/discord/Hono imports. */

import { isHiddenRarity, type RarityKey } from "./rarity.js";

export const GIVE_TTL_SEC = 900;

export function giveExpiry(now: number): number {
  return now + GIVE_TTL_SEC;
}

export type GiveMode = "public" | "direct";

export type GiveAction = "claim" | "accept" | "reject" | "cancel";

export type GiveStatus =
  | "open"
  | "claimed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

export type GiveValidationError =
  | "self-gift"
  | "bot-target"
  | "card-not-owned"
  | "card-hidden-rarity"
  | "card-disabled";

/** Holo and secret rarity cards are never giftable (user decision). */
export function isGiftableRarity(rarity: RarityKey): boolean {
  return !isHiddenRarity(rarity);
}

export interface NewGiveInput {
  giverId: string;
  targetId: string | null;
  targetIsBot: boolean;
  ownsCard: boolean;
  cardEnabled: boolean;
  rarity: RarityKey | null;
}

export function validateNewGive(
  input: NewGiveInput,
): GiveValidationError | null {
  if (input.targetId !== null && input.giverId === input.targetId) {
    return "self-gift";
  }
  if (input.targetIsBot) return "bot-target";
  if (!input.cardEnabled) return "card-disabled";
  if (!input.ownsCard) return "card-not-owned";
  if (input.rarity === null || !isGiftableRarity(input.rarity)) {
    return "card-hidden-rarity";
  }
  return null;
}

export interface GiveClickTarget {
  action: GiveAction;
  giveId: string;
}

const GIVE_ACTIONS: readonly GiveAction[] = ["claim", "accept", "reject", "cancel"];

function isGiveAction(value: string): value is GiveAction {
  return (GIVE_ACTIONS as readonly string[]).includes(value);
}

/** Parses `give:<action>:<giveId>`. Null on any other shape. */
export function parseGiveCustomId(customId: string): GiveClickTarget | null {
  const parts = customId.split(":");
  if (parts.length !== 3) return null;
  const [ns, action, giveId] = parts as [string, string, string];
  if (ns !== "give") return null;
  if (!isGiveAction(action)) return null;
  if (giveId === "" || giveId.includes(":")) return null;
  return { action, giveId };
}

export function giveCustomId(action: GiveAction, giveId: string): string {
  return `give:${action}:${giveId}`;
}

export function canClickGive(
  action: GiveAction,
  clickerId: string | null,
  giverId: string,
  targetId: string | null,
): boolean {
  if (clickerId === null) return false;
  if (action === "cancel") return clickerId === giverId;
  if (action === "claim") return targetId === null && clickerId !== giverId;
  if (targetId === null) return false;
  return clickerId === targetId;
}
