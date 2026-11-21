/** Pure dismantle/redeem economy: no db/discord/Hono imports. */

import { isHiddenRarity, type RarityKey } from "./rarity.js";

/** Melt value per dismantled copy. Holo/secret are 0: never meltable. */
export const MELT_POINTS_BY_RARITY: Record<RarityKey, number> = {
  common: 5,
  rare: 10,
  super_rare: 20,
  ultra_rare: 40,
  holo: 0,
  secret: 0,
};

/** Points cost of one stamina via /tukar-poin. */
export const MELT_POINTS_PER_STAMINA = 100;

/** Point value of one copy of the given rarity. */
export function meltPointsForRarity(rarity: RarityKey): number {
  return MELT_POINTS_BY_RARITY[rarity] ?? 0;
}

export type MeltValidationError =
  | "card-not-owned"
  | "last-copy"
  | "card-hidden-rarity"
  | "card-disabled";

export interface NewMeltInput {
  ownsCard: boolean;
  quantity: number;
  cardEnabled: boolean;
  rarity: RarityKey | null;
}

export function validateNewMelt(
  input: NewMeltInput,
): MeltValidationError | null {
  if (!input.cardEnabled) return "card-disabled";
  if (!input.ownsCard || input.quantity < 1) return "card-not-owned";
  if (input.rarity === null || isHiddenRarity(input.rarity)) {
    return "card-hidden-rarity";
  }
  if (input.quantity < 2) return "last-copy";
  return null;
}

export type RedeemValidationError = "no-balance" | "pool-not-found";

/** Whole stamina purchasable with the given point balance. */
export function redeemableStamina(points: number): number {
  return Math.floor(points / MELT_POINTS_PER_STAMINA);
}

export function validateRedeem(
  points: number,
  poolExists: boolean,
): RedeemValidationError | null {
  if (!poolExists) return "pool-not-found";
  if (redeemableStamina(points) < 1) return "no-balance";
  return null;
}
