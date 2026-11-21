import { describe, expect, it } from "vitest";
import { app } from "../src/index.js";
import { isD1DailyQuotaError } from "../src/db/client.js";

const QUOTA_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";

type RequestEnv = Parameters<typeof app.request>[2];

function quotaEnv(): RequestEnv {
  const quota = new Error(QUOTA_MESSAGE);
  const stmt = {
    bind: () => stmt,
    all: () => Promise.reject(quota),
    first: () => Promise.reject(quota),
    run: () => Promise.reject(quota),
    raw: () => Promise.reject(quota),
  };
  return { DB: { prepare: () => stmt } } as unknown as RequestEnv;
}

describe("isD1DailyQuotaError", () => {
  it("matches the D1 free-tier daily row-read cap message", () => {
    expect(isD1DailyQuotaError(new Error(QUOTA_MESSAGE))).toBe(true);
  });

  it("matches when Drizzle wraps the D1 message on cause", () => {
    const wrapped = new Error("Failed query: select ... from cards");
    wrapped.cause = new Error(QUOTA_MESSAGE);
    expect(isD1DailyQuotaError(wrapped)).toBe(true);
  });

  it("ignores other D1 failures", () => {
    expect(isD1DailyQuotaError(new Error("D1_ERROR: no such table: cards"))).toBe(
      false,
    );
    expect(isD1DailyQuotaError("network down")).toBe(false);
  });
});

describe("quota outage reply", () => {
  it("answers a read with 503 and a readable message, not a bare 500", async () => {
    const res = await app.request("/kartu/alik-01", {}, quotaEnv());

    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Kuota baca database harian habis");
  });
});
