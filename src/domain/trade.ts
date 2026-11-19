/** Pure trade validation: no db/discord/Hono imports. */

export const MAX_PENDING_TRADES = 3;

export const TRADE_TTL_SEC = 86400;

export function tradeExpiry(now: number): number {
  return now + TRADE_TTL_SEC;
}

export type TradeValidationError =
  | "self-trade"
  | "bot-target"
  | "same-card"
  | "offer-not-owned"
  | "request-not-owned"
  | "offer-disabled"
  | "request-disabled"
  | "pending-limit";

export interface NewTradeInput {
  proposerId: string;
  targetId: string;
  targetIsBot: boolean;
  offerCardId: string;
  requestCardId: string;
  proposerPending: number;
  proposerOwnsOffer: boolean;
  targetOwnsRequest: boolean;
  offerEnabled: boolean;
  requestEnabled: boolean;
}

export function validateNewTrade(
  input: NewTradeInput,
): TradeValidationError | null {
  if (input.proposerId === input.targetId) return "self-trade";
  if (input.targetIsBot) return "bot-target";
  if (input.offerCardId === input.requestCardId) return "same-card";
  if (!input.offerEnabled) return "offer-disabled";
  if (!input.requestEnabled) return "request-disabled";
  if (!input.proposerOwnsOffer) return "offer-not-owned";
  if (!input.targetOwnsRequest) return "request-not-owned";
  if (input.proposerPending >= MAX_PENDING_TRADES) return "pending-limit";
  return null;
}

export type TradeAction = "accept" | "decline" | "cancel";

export interface TradeClickTarget {
  action: TradeAction;
  tradeId: string;
}

const TRADE_ACTIONS: readonly TradeAction[] = ["accept", "decline", "cancel"];

function isTradeAction(value: string): value is TradeAction {
  return (TRADE_ACTIONS as readonly string[]).includes(value);
}

export function parseTradeCustomId(customId: string): TradeClickTarget | null {
  const parts = customId.split(":");
  if (parts.length !== 3) return null;
  const [ns, action, tradeId] = parts as [string, string, string];
  if (ns !== "trade") return null;
  if (!isTradeAction(action)) return null;
  if (tradeId === "" || tradeId.includes(":")) return null;
  return { action, tradeId };
}

export function tradeCustomId(action: TradeAction, tradeId: string): string {
  return `trade:${action}:${tradeId}`;
}

export function canClickTrade(
  action: TradeAction,
  clickerId: string | null,
  proposerId: string,
  targetId: string,
): boolean {
  if (clickerId === null) return false;
  if (action === "cancel") return clickerId === proposerId;
  return clickerId === targetId;
}
