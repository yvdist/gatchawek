import { describe, expect, it } from "vitest";
import {
  badgeForGroupName,
  planGroupForImport,
  slugifyGroupId,
  type ImportPoolGroup,
} from "../src/domain/importGroups.js";

const POOLS: readonly ImportPoolGroup[] = [
  { poolId: "ahli-ngebul", groupId: "default", groupName: "Default" },
  { poolId: "ahli-ngebul", groupId: "koleksi", groupName: "Koleksi" },
  { poolId: "pejabat", groupId: "kabinet", groupName: "Kabinet" },
];

describe("planGroupForImport", () => {
  it("falls back to the dropdown for null or blank segments", () => {
    expect(planGroupForImport(null, POOLS, "ahli-ngebul")).toBe("use-dropdown");
    expect(planGroupForImport("   ", POOLS, "ahli-ngebul")).toBe(
      "use-dropdown",
    );
  });

  it("reuses the existing group for exact, case, and spacing variants", () => {
    expect(planGroupForImport("Default", POOLS, "ahli-ngebul")).toEqual({
      use: { poolId: "ahli-ngebul", groupId: "default" },
    });
    expect(planGroupForImport("DEFAULT", POOLS, "ahli-ngebul")).toEqual({
      use: { poolId: "ahli-ngebul", groupId: "default" },
    });
    expect(planGroupForImport("  default ", POOLS, "ahli-ngebul")).toEqual({
      use: { poolId: "ahli-ngebul", groupId: "default" },
    });
  });

  it("prefers the dropdown pool when the name exists in several pools", () => {
    const dupes: ImportPoolGroup[] = [
      { poolId: "ahli-ngebul", groupId: "ramean", groupName: "Ramean" },
      { poolId: "pejabat", groupId: "ramean-pjb", groupName: "Ramean" },
    ];
    expect(planGroupForImport("Ramean", dupes, "ahli-ngebul")).toEqual({
      use: { poolId: "ahli-ngebul", groupId: "ramean" },
    });
    // Same name + groupId alias match.
    expect(planGroupForImport("ramean-pjb", dupes, "pejabat")).toEqual({
      use: { poolId: "pejabat", groupId: "ramean-pjb" },
    });
  });

  it("routes a globally unique cross-pool name to its pool", () => {
    expect(planGroupForImport("Kabinet", POOLS, "ahli-ngebul")).toEqual({
      use: { poolId: "pejabat", groupId: "kabinet" },
    });
  });

  it("marks ambiguous when the name matches several non-preferred pools", () => {
    const dupes: ImportPoolGroup[] = [
      { poolId: "pejabat", groupId: "g-a", groupName: "Ramean" },
      { poolId: "meme", groupId: "g-b", groupName: "Ramean" },
    ];
    expect(planGroupForImport("Ramean", dupes, "ahli-ngebul")).toBe(
      "ambiguous",
    );
  });

  it("plans creation in the preferred pool for an unknown group", () => {
    expect(planGroupForImport("Ramean", POOLS, "ahli-ngebul")).toEqual({
      create: {
        poolId: "ahli-ngebul",
        groupId: "ramean",
        name: "Ramean",
        badge: "RAMEAN",
      },
    });
    expect(planGroupForImport("Lucu Banget", POOLS, "ahli-ngebul")).toEqual({
      create: {
        poolId: "ahli-ngebul",
        groupId: "lucu-banget",
        name: "Lucu Banget",
        badge: "LUCUBA",
      },
    });
  });

  it("normalizes double spaces and punctuation into slug/name/badge", () => {
    expect(planGroupForImport("Ramean!  Seru", POOLS, "ahli-ngebul")).toEqual({
      create: {
        poolId: "ahli-ngebul",
        groupId: "ramean-seru",
        name: "Ramean! Seru",
        badge: "RAMEAN",
      },
    });
  });

  it("falls back to GRP badge and rejects symbol-only names as ambiguous", () => {
    expect(badgeForGroupName("Ramean 123")).toBe("RAMEAN");
    expect(badgeForGroupName("!!!")).toBe("GRP");
    expect(planGroupForImport("@#$%", POOLS, "ahli-ngebul")).toBe("ambiguous");
    expect(planGroupForImport("Ramean!", POOLS, "ahli-ngebul")).toEqual({
      create: {
        poolId: "ahli-ngebul",
        groupId: "ramean",
        name: "Ramean!",
        badge: "RAMEAN",
      },
    });
  });

  it("derives slugs without leading/trailing dashes", () => {
    expect(slugifyGroupId("  Ramean  ")).toBe("ramean");
    expect(slugifyGroupId("Ramean!")).toBe("ramean");
    expect(slugifyGroupId("!!!")).toBe("");
  });
});
