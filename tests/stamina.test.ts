import { describe, expect, it } from "vitest";
import {
  canReset,
  consume,
  fullAt,
  nextTickAt,
  normalize,
  resetReadyAt,
} from "../src/domain/stamina.js";

const MAX = 10;
const INTERVAL = 1500;

describe("stamina normalize", () => {
  it("credits only whole ticks (partial regen)", () => {
    const n = normalize({ stamina: 5, anchorAt: 1000 }, MAX, INTERVAL, 1000 + 2 * INTERVAL + 700);
    expect(n).toEqual({ stamina: 7, anchorAt: 1000 + 2 * INTERVAL });
  });

  it("anchor advances by whole ticks only", () => {
    const n = normalize({ stamina: 5, anchorAt: 1000 }, MAX, INTERVAL, 1000 + INTERVAL + 1);
    expect(n.anchorAt).toBe(1000 + INTERVAL);
  });

  it("clamps stamina above max", () => {
    expect(normalize({ stamina: 99, anchorAt: 5 }, MAX, INTERVAL, 5000)).toEqual({
      stamina: MAX,
      anchorAt: 5000,
    });
  });

  it("never goes negative when the clock runs backwards", () => {
    expect(normalize({ stamina: 4, anchorAt: 5000 }, MAX, INTERVAL, 1000)).toEqual({
      stamina: 4,
      anchorAt: 5000,
    });
  });

  it("full stays full with anchor reset to now", () => {
    expect(normalize({ stamina: MAX, anchorAt: 100 }, MAX, INTERVAL, 999)).toEqual({
      stamina: MAX,
      anchorAt: 999,
    });
  });
});

describe("stamina consume", () => {
  it("consume at full keeps anchor at now", () => {
    const after = consume({ stamina: MAX, anchorAt: 100 }, MAX, INTERVAL, 7777);
    expect(after).toEqual({ stamina: MAX - 1, anchorAt: 7777 });
  });

  it("empty after regen returns null", () => {
    expect(consume({ stamina: 0, anchorAt: 1000 }, MAX, INTERVAL, 1000)).toBeNull();
  });

  it("consume after ticks subtracts from the normalized value", () => {
    const after = consume(
      { stamina: 1, anchorAt: 1000 },
      MAX,
      INTERVAL,
      1000 + 3 * INTERVAL,
    );
    expect(after).toEqual({ stamina: 3, anchorAt: 1000 + 3 * INTERVAL });
  });
});

describe("nextTickAt / fullAt", () => {
  it("fullAt projects remaining misses", () => {
    const n = normalize({ stamina: 7, anchorAt: 1000 }, 10, 100, 1000);
    expect(fullAt(n, 10, 100)).toBe(1000 + 3 * 100);
  });

  it("null when full", () => {
    const n = { stamina: MAX, anchorAt: 5 };
    expect(nextTickAt(n, MAX, INTERVAL)).toBeNull();
    expect(fullAt(n, MAX, INTERVAL)).toBeNull();
  });

  it("nextTickAt is one interval past a partial anchor", () => {
    const n = normalize({ stamina: 5, anchorAt: 1000 }, MAX, INTERVAL, 1000 + 2 * INTERVAL + 700);
    expect(nextTickAt(n, MAX, INTERVAL)).toBe(1000 + 3 * INTERVAL);
  });
});

describe("resetReadyAt / canReset", () => {
  it("never reset before means ready at 0", () => {
    expect(resetReadyAt(null, 3600)).toBe(0);
  });

  it("denies when full without touching the cooldown", () => {
    const r = canReset({ stamina: MAX, anchorAt: 9 }, MAX, 1234, 3600, 9999);
    expect(r).toEqual({ ok: false, reason: "full", readyAt: 9999 });
  });

  it("denies during cooldown with the ready timestamp", () => {
    const r = canReset({ stamina: 3, anchorAt: 1 }, MAX, 5000, 3600, 6000);
    expect(r).toEqual({ ok: false, reason: "cooldown", readyAt: 8600 });
  });

  it("allows a spent pool past cooldown", () => {
    expect(
      canReset({ stamina: 3, anchorAt: 1 }, MAX, 5000, 3600, 8600),
    ).toEqual({ ok: true });
  });

  it("allows first reset (never reset) on a spent pool", () => {
    expect(
      canReset({ stamina: 0, anchorAt: 1 }, MAX, null, 3600, 50),
    ).toEqual({ ok: true });
  });
});
