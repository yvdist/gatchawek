import { describe, expect, it } from "vitest";
import { resolveSeedTarget } from "../scripts/seed.js";

describe("resolveSeedTarget", () => {
  it("defaults to local D1", () => {
    expect(resolveSeedTarget([])).toEqual({ remote: false, env: null });
  });

  it("parses --remote without env vars", () => {
    expect(resolveSeedTarget(["--remote"])).toEqual({
      remote: true,
      env: null,
    });
  });

  it("parses --env staging", () => {
    expect(resolveSeedTarget(["--env", "staging"])).toEqual({
      remote: false,
      env: "staging",
    });
  });

  it("keeps SEED_TARGET=remote for POSIX compat", () => {
    process.env.SEED_TARGET = "remote";
    try {
      expect(resolveSeedTarget([])).toEqual({ remote: true, env: null });
    } finally {
      delete process.env.SEED_TARGET;
    }
  });
});
