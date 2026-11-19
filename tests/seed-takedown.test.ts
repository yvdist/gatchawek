import { describe, expect, it } from "vitest";
import { renderSeedSql } from "../scripts/seed.js";
import type { LoadedManifests } from "../scripts/lib/manifests.js";

function loaded(groups: LoadedManifests["groups"]): LoadedManifests {
  return {
    pools: [
      {
        id: "pejabat",
        name: "Pejabat",
        emoji: "🏛️",
        staminaMax: 10,
        regenIntervalSec: 1500,
        resetCooldownSec: 10800,
        sortOrder: 0,
      },
    ],
    poolIds: new Set(["pejabat"]),
    groups,
  };
}

const groupA = {
  file: "a.json",
  manifest: {
    schemaVersion: 1 as const,
    pool: "pejabat",
    group: { id: "grup-a", name: "Grup A", badge: "A" },
    members: [
      {
        id: "anna",
        name: "Anna",
        fullName: null,
        sortOrder: 0,
        photos: [
          {
            photoNo: 1,
            rarity: "common" as const,
            imageUrl: "https://example.test/a.jpg",
            sourcePageUrl: "https://example.test/a",
            license: null,
            author: null,
          },
        ],
      },
    ],
  },
};

describe("seed takedown", () => {
  it("disables groups/members/cards missing from the manifest", () => {
    const sql = renderSeedSql(
      loaded([groupA]),
      new Map([["anna-01", "anna-01.abc12345.webp"]]),
      {
        cards: { "anna-01": 1 },
        pools: { pejabat: 1 },
      },
    );
    expect(sql).toContain("UPDATE cards SET enabled=0");
    expect(sql).toContain("UPDATE groups SET enabled=0");
    expect(sql).toContain("UPDATE members SET enabled=0");
  });

  it("keeps live rows enabled via upsert re-enable", () => {
    const sql = renderSeedSql(
      loaded([groupA]),
      new Map([["anna-01", "anna-01.abc12345.webp"]]),
      {
        cards: { "anna-01": 1 },
        pools: { pejabat: 1 },
      },
    );
    expect(sql).toContain("INSERT INTO groups");
    expect(sql).toContain("enabled=1;");
  });
});
