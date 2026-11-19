import { describe, expect, it } from "vitest";
import {
  clampPage,
  koleksiPageCustomId,
  ownerGate,
  parseKoleksiPageCustomId,
} from "../src/domain/koleksi.js";
import { formatOwnedPhotos } from "../src/ui/koleksiEmbed.js";

describe("clampPage", () => {
  it("returns 0 when there are no pages", () => {
    expect(clampPage(0, 0)).toBe(0);
    expect(clampPage(5, 0)).toBe(0);
    expect(clampPage(5, -2)).toBe(0);
  });
  it("clamps negatives and NaN to 0", () => {
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(Number.NaN, 3)).toBe(0);
  });
  it("clamps over-range to the last page", () => {
    expect(clampPage(9, 3)).toBe(2);
    expect(clampPage(2, 3)).toBe(2);
  });
  it("floors fractional pages", () => {
    expect(clampPage(1.9, 5)).toBe(1);
  });
});

describe("parseKoleksiPageCustomId", () => {
  it("parses a valid custom id", () => {
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat:*:0")).toEqual({
      ownerId: "123",
      poolId: "pejabat",
      groupId: "*",
      page: 0,
    });
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat:g1:12")).toEqual({
      ownerId: "123",
      poolId: "pejabat",
      groupId: "g1",
      page: 12,
    });
  });
  it("rejects six malformed shapes", () => {
    expect(parseKoleksiPageCustomId("gacha:again:pejabat:123")).toBeNull();
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat")).toBeNull();
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat:*:0:extra")).toBeNull();
    expect(parseKoleksiPageCustomId("koleksi:p::pejabat:*:0")).toBeNull();
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat:*:abc")).toBeNull();
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat:*:1000000")).toBeNull();
  });

  it("accepts four-to-six digit pages", () => {
    expect(parseKoleksiPageCustomId("koleksi:p:123:pejabat:*:1000")).toEqual({
      ownerId: "123",
      poolId: "pejabat",
      groupId: "*",
      page: 1000,
    });
  });
});

describe("koleksiPageCustomId", () => {
  it("round-trips through the parser and stays short", () => {
    const id = koleksiPageCustomId("123456789012345678", "pejabat", "g1", 2);
    expect(parseKoleksiPageCustomId(id)).toEqual({
      ownerId: "123456789012345678",
      poolId: "pejabat",
      groupId: "g1",
      page: 2,
    });
    expect(id.length).toBeLessThan(100);
  });
});

describe("ownerGate", () => {
  it("accepts the owner, rejects others and null", () => {
    expect(ownerGate("123", "123")).toBe(true);
    expect(ownerGate("456", "123")).toBe(false);
    expect(ownerGate(null, "123")).toBe(false);
  });
});

describe("formatOwnedPhotos", () => {
  it("formats duplicates with × and omits qty 1", () => {
    expect(
      formatOwnedPhotos([
        { photoNo: 11, quantity: 2 },
        { photoNo: 3, quantity: 1 },
        { photoNo: 5, quantity: 1 },
      ]),
    ).toBe("#3 #5 #11×2");
  });
  it("returns an em dash when empty", () => {
    expect(formatOwnedPhotos([])).toBe("—");
  });
  it("sorts ascending", () => {
    expect(
      formatOwnedPhotos([
        { photoNo: 5, quantity: 1 },
        { photoNo: 1, quantity: 3 },
      ]),
    ).toBe("#1×3 #5");
  });
});
