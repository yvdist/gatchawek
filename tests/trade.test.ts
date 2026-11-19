import { describe, expect, it } from "vitest";
import {
  canClickTrade,
  MAX_PENDING_TRADES,
  parseTradeCustomId,
  tradeCustomId,
  tradeExpiry,
  TRADE_TTL_SEC,
  validateNewTrade,
  type NewTradeInput,
} from "../src/domain/trade.js";

function base(): NewTradeInput {
  return {
    proposerId: "u1",
    targetId: "u2",
    targetIsBot: false,
    offerCardId: "anna-01",
    requestCardId: "budi-01",
    proposerPending: 0,
    proposerOwnsOffer: true,
    targetOwnsRequest: true,
    offerEnabled: true,
    requestEnabled: true,
  };
}

describe("validateNewTrade", () => {
  it("accepts a well-formed trade", () => {
    expect(validateNewTrade(base())).toBeNull();
  });

  it("rejects self-trade", () => {
    expect(validateNewTrade({ ...base(), targetId: "u1" })).toBe("self-trade");
  });

  it("rejects bot target", () => {
    expect(validateNewTrade({ ...base(), targetIsBot: true })).toBe(
      "bot-target",
    );
  });

  it("rejects same card", () => {
    expect(
      validateNewTrade({ ...base(), requestCardId: "anna-01" }),
    ).toBe("same-card");
  });

  it("rejects disabled offer/request", () => {
    expect(validateNewTrade({ ...base(), offerEnabled: false })).toBe(
      "offer-disabled",
    );
    expect(validateNewTrade({ ...base(), requestEnabled: false })).toBe(
      "request-disabled",
    );
  });

  it("rejects unowned cards", () => {
    expect(validateNewTrade({ ...base(), proposerOwnsOffer: false })).toBe(
      "offer-not-owned",
    );
    expect(validateNewTrade({ ...base(), targetOwnsRequest: false })).toBe(
      "request-not-owned",
    );
  });

  it("enforces pending limit", () => {
    expect(
      validateNewTrade({ ...base(), proposerPending: MAX_PENDING_TRADES }),
    ).toBe("pending-limit");
    expect(
      validateNewTrade({
        ...base(),
        proposerPending: MAX_PENDING_TRADES - 1,
      }),
    ).toBeNull();
  });

  it("checks in order: self before bot before same-card", () => {
    expect(
      validateNewTrade({
        ...base(),
        proposerId: "x",
        targetId: "x",
        targetIsBot: true,
        offerCardId: "c",
        requestCardId: "c",
      }),
    ).toBe("self-trade");
  });
});

describe("tradeExpiry", () => {
  it("adds 24h TTL", () => {
    expect(TRADE_TTL_SEC).toBe(86400);
    expect(tradeExpiry(1000)).toBe(87400);
  });
});

describe("parseTradeCustomId", () => {
  it("parses the three actions", () => {
    for (const action of ["accept", "decline", "cancel"] as const) {
      expect(parseTradeCustomId(`trade:${action}:abc-123`)).toEqual({
        action,
        tradeId: "abc-123",
      });
    }
  });

  it("rejects malformed ids", () => {
    expect(parseTradeCustomId("trade:accept:")).toBeNull();
    expect(parseTradeCustomId("trade:accept")).toBeNull();
    expect(parseTradeCustomId("trade:accept:a:b")).toBeNull();
    expect(parseTradeCustomId("trade:hug:abc")).toBeNull();
    expect(parseTradeCustomId("gacha:accept:abc")).toBeNull();
  });
});

describe("tradeCustomId", () => {
  it("round-trips and stays under 100 chars", () => {
    const id = tradeCustomId("accept", "123e4567-e89b-12d3-a456-426614174000");
    expect(id.length).toBeLessThan(100);
    expect(parseTradeCustomId(id)?.action).toBe("accept");
    expect(parseTradeCustomId(id)?.tradeId).toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    );
  });
});

describe("canClickTrade", () => {
  it("gates accept/decline to target and cancel to proposer", () => {
    expect(canClickTrade("accept", "u2", "u1", "u2")).toBe(true);
    expect(canClickTrade("decline", "u2", "u1", "u2")).toBe(true);
    expect(canClickTrade("accept", "u1", "u1", "u2")).toBe(false);
    expect(canClickTrade("cancel", "u1", "u1", "u2")).toBe(true);
    expect(canClickTrade("cancel", "u2", "u1", "u2")).toBe(false);
    expect(canClickTrade("accept", "u3", "u1", "u2")).toBe(false);
    expect(canClickTrade("accept", null, "u1", "u2")).toBe(false);
  });
});
