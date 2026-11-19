import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildHelpEmbed } from "../src/ui/helpEmbed.js";
import { commandDefinitions } from "../src/commands/registry.js";
import {
  RARITY_KEYS,
  RARITY_LABEL,
  RARITY_STARS,
  RARITY_WEIGHTS,
} from "../src/domain/rarity.js";

const emptyCatalog = { pools: [] };

function buildEmbed() {
  return buildHelpEmbed({
    userId: "123",
    catalog: emptyCatalog,
    baseUrl: "example.com",
    commands: commandDefinitions,
  });
}

describe("help hardening (phase 5)", () => {
  it("memuat /trade dan /help", () => {
    const embed = buildEmbed();
    expect(embed.description).toContain("`/trade`");
    expect(embed.description).toContain("`/help`");
  });

  it("mencantumkan setiap command dari registry dengan deskripsinya", () => {
    const embed = buildEmbed();
    for (const c of commandDefinitions) {
      expect(embed.description).toContain(`\`/${c.name}\``);
      expect(embed.description).toContain(c.description);
    }
  });

  it("rate dihitung dari RARITY_WEIGHTS", () => {
    const embed = buildEmbed();
    let total = 0;
    for (const k of RARITY_KEYS) total += RARITY_WEIGHTS[k];
    for (const key of RARITY_KEYS) {
      const pct =
        total > 0 ? Math.round((RARITY_WEIGHTS[key] / total) * 100) : 0;
      expect(embed.description).toContain(
        `${RARITY_STARS[key]} ${RARITY_LABEL[key]} — ${pct}%`,
      );
    }
  });

  it("tidak ada hardcode nama pool/grup di source helpEmbed", async () => {
    const source = (
      await readFile("src/ui/helpEmbed.ts", "utf8")
    ).toLowerCase();
    for (const literal of ["pejabat", "kabinet", "meovv"]) {
      expect(source).not.toContain(literal);
    }
  });
});
