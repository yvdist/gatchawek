import type { RarityKey } from "./rarity.js";

/** Pure PvP 1v1 blind-pick auto-battle rules: no db/discord/Hono imports. */

export const MAX_PENDING_BATTLES = 3;
export const BATTLE_TTL_SEC = 900;

export const BATTLE_BASE_POWER: Record<RarityKey, number> = {
  common: 100,
  rare: 135,
  super_rare: 175,
  ultra_rare: 220,
  holo: 275,
  secret: 340,
};

export const BATTLE_DUP_STEP = 5;
export const BATTLE_DUP_CAP = 50;
export const BATTLE_RNG_MAX = 100;
export const BATTLE_CRIT_CHANCE = 0.15;
export const BATTLE_CRIT_BONUS = 55;

export type BattleMode = "casual" | "wager";

export function parseBattleMode(raw: string | null | undefined): BattleMode {
  return raw === "wager" ? "wager" : "casual";
}

export function battleExpiry(now: number): number {
  return now + BATTLE_TTL_SEC;
}

export type BattleValidationError =
  | "self-battle"
  | "bot-target"
  | "card-not-owned"
  | "card-disabled"
  | "target-has-no-cards"
  | "pending-limit";

export interface NewBattleInput {
  challengerId: string;
  targetId: string;
  targetIsBot: boolean;
  challengerPending: number;
  challengerOwnsCard: boolean;
  cardEnabled: boolean;
  targetCardCount: number;
}

export function validateNewBattle(
  input: NewBattleInput,
): BattleValidationError | null {
  if (input.challengerId === input.targetId) return "self-battle";
  if (input.targetIsBot) return "bot-target";
  if (!input.cardEnabled) return "card-disabled";
  if (!input.challengerOwnsCard) return "card-not-owned";
  if (input.targetCardCount <= 0) return "target-has-no-cards";
  if (input.challengerPending >= MAX_PENDING_BATTLES) return "pending-limit";
  return null;
}

export function duplicateBonus(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(
    BATTLE_DUP_CAP,
    Math.max(0, Math.floor(quantity) - 1) * BATTLE_DUP_STEP,
  );
}

export interface FighterRoll {
  base: number;
  dupBonus: number;
  rng: number;
  isCrit: boolean;
  critBonus: number;
  total: number;
}

export function computeFighterRoll(args: {
  rarity: RarityKey;
  quantity: number;
  rngRoll: number;
  critRoll: number;
}): FighterRoll {
  const base = BATTLE_BASE_POWER[args.rarity];
  const dupBonus = duplicateBonus(args.quantity);
  const clampedRng = Math.min(0.999999999, Math.max(0, args.rngRoll));
  const rng = Math.floor(clampedRng * BATTLE_RNG_MAX);
  const isCrit = args.critRoll < BATTLE_CRIT_CHANCE;
  const critBonus = isCrit ? BATTLE_CRIT_BONUS : 0;
  return {
    base,
    dupBonus,
    rng,
    isCrit,
    critBonus,
    total: base + dupBonus + rng + critBonus,
  };
}

export interface BattleCalculationResult {
  winnerId: string;
  loserId: string;
  challengerRoll: FighterRoll;
  targetRoll: FighterRoll;
  tieBroken: boolean;
}

export function resolveBattleCalculation(args: {
  challengerId: string;
  targetId: string;
  challenger: { rarity: RarityKey; quantity: number };
  target: { rarity: RarityKey; quantity: number };
  rand: () => number;
}): BattleCalculationResult {
  const challengerRoll = computeFighterRoll({
    rarity: args.challenger.rarity,
    quantity: args.challenger.quantity,
    rngRoll: args.rand(),
    critRoll: args.rand(),
  });
  const targetRoll = computeFighterRoll({
    rarity: args.target.rarity,
    quantity: args.target.quantity,
    rngRoll: args.rand(),
    critRoll: args.rand(),
  });

  if (challengerRoll.total === targetRoll.total) {
    const challengerWinsTie = args.rand() < 0.5;
    if (challengerWinsTie) {
      challengerRoll.rng += 1;
      challengerRoll.total += 1;
      return {
        winnerId: args.challengerId,
        loserId: args.targetId,
        challengerRoll,
        targetRoll,
        tieBroken: true,
      };
    }
    targetRoll.rng += 1;
    targetRoll.total += 1;
    return {
      winnerId: args.targetId,
      loserId: args.challengerId,
      challengerRoll,
      targetRoll,
      tieBroken: true,
    };
  }

  const challengerWon = challengerRoll.total > targetRoll.total;
  return {
    winnerId: challengerWon ? args.challengerId : args.targetId,
    loserId: challengerWon ? args.targetId : args.challengerId,
    challengerRoll,
    targetRoll,
    tieBroken: false,
  };
}

export type BattleAction = "pick" | "decline" | "cancel";

export interface BattleComponentTarget {
  action: BattleAction;
  battleId: string;
}

const BATTLE_ACTIONS: readonly BattleAction[] = ["pick", "decline", "cancel"];

function isBattleAction(value: string): value is BattleAction {
  return (BATTLE_ACTIONS as readonly string[]).includes(value);
}

export function battleCustomId(action: BattleAction, battleId: string): string {
  return `battle:${action}:${battleId}`;
}

export function parseBattleCustomId(
  customId: string,
): BattleComponentTarget | null {
  const parts = customId.split(":");
  if (parts.length !== 3) return null;
  const [ns, action, battleId] = parts as [string, string, string];
  if (ns !== "battle") return null;
  if (!isBattleAction(action)) return null;
  if (battleId === "" || battleId.includes(":")) return null;
  return { action, battleId };
}

export function canActOnBattle(
  action: BattleAction,
  actorId: string | null,
  challengerId: string,
  targetId: string,
): boolean {
  if (actorId === null) return false;
  if (action === "cancel") return actorId === challengerId;
  return actorId === targetId;
}
