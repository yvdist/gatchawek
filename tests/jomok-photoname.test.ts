import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cardDisplayName } from "../src/domain/gacha.js";
import { groupManifestSchema } from "../shared/manifest.schema.js";
import { loadManifests } from "../scripts/lib/manifests.js";
import { collectCardInputs, readSerialsLock } from "../scripts/lib/card-inputs.js";
import { renderSeedSql } from "../scripts/seed.js";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("jomok per-photo names", () => {
  it("every jomok photo carries a non-empty label", async () => {
    const raw = await readFile(
      `${REPO_ROOT}data/groups/meme/jomok.json`,
      "utf8",
    );
    const manifest = groupManifestSchema.parse(JSON.parse(raw));
    expect(manifest.members.length).toBe(18);
    const photos = manifest.members.flatMap((m) => m.photos);
    expect(photos.length).toBe(108);
    for (const photo of photos) {
      expect(typeof photo.label).toBe("string");
      expect(photo.label === undefined ? "" : photo.label.length).toBeGreaterThan(0);
    }
  });

  it("cardDisplayName prefers the photo label, falls back to member", () => {
    expect(cardDisplayName("Ryan Unjuk Kebolehan", "Jomok Mix 18")).toBe(
      "Ryan Unjuk Kebolehan",
    );
    expect(cardDisplayName(null, "Katak Bijak")).toBe("Katak Bijak");
  });

  it("collectCardInputs forwards manifest labels into inputs", async () => {
    const { inputs } = await collectCardInputs(REPO_ROOT);
    const jomok = inputs.filter((i) => i.cardId.startsWith("jomok-mix-"));
    expect(jomok.length).toBe(108);
    for (const input of jomok) {
      expect(input.photoLabel).toBeTypeOf("string");
    }
    const nonJomok = inputs.filter((i) => !i.cardId.startsWith("jomok-mix-"));
    expect(nonJomok.length).toBeGreaterThan(0);
    for (const input of nonJomok) {
      expect(input.photoLabel).toBeNull();
    }
  });

  it("seed SQL writes photo_label on insert and upsert", async () => {
    const loaded = await loadManifests(REPO_ROOT);
    const lock = await readSerialsLock(REPO_ROOT);
    const builtFiles = new Map<string, string>();
    for (const { manifest } of loaded.groups) {
      for (const member of manifest.members) {
        for (const photo of member.photos) {
          if (photo.enabled) {
            builtFiles.set(
              `${member.id}-${String(photo.photoNo).padStart(2, "0")}`,
              "dummy.webp",
            );
          }
        }
      }
    }
    const sql = renderSeedSql(loaded, builtFiles, lock);
    expect(sql).toContain("photo_label");
    expect(sql).toContain("photo_label=excluded.photo_label");
  });
});
