import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cardDisplayName } from "../src/domain/gacha.js";
import { groupManifestSchema } from "../shared/manifest.schema.js";
import { loadManifests } from "../scripts/lib/manifests.js";
import { collectCardInputs, readSerialsLock } from "../scripts/lib/card-inputs.js";
import { renderSeedSql } from "../scripts/seed.js";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

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
    // Self-contained fixture: one labeled photo (label forwarded) and one
    // unlabeled photo (null). Never depends on repo raw-file state.
    const root = await mkdtemp(path.join(tmpdir(), "gatchawek-photoname-"));
    roots.push(root);
    await mkdir(path.join(root, "data", "groups", "meme"), { recursive: true });
    await mkdir(path.join(root, "data", "groups", "pejabat"), { recursive: true });
    await writeFile(
      path.join(root, "data", "pools.json"),
      JSON.stringify([
        { id: "meme", name: "Jomok", emoji: "🐸", staminaMax: 10, regenIntervalSec: 1500, resetCooldownSec: 10800, sortOrder: 1 },
        { id: "pejabat", name: "Pejabat", emoji: "🏛️", staminaMax: 10, regenIntervalSec: 1500, resetCooldownSec: 10800, sortOrder: 0 },
      ]),
    );
    const member = (id: string, label: string | null) => ({
      id,
      name: id,
      photos: [1, 2, 3].map((photoNo) => ({
        photoNo,
        rarity: "common",
        imageUrl: "https://example.com/wiki/foto",
        sourcePageUrl: "https://example.com/wiki/foto",
        license: null,
        author: null,
        ...(label === null ? {} : { label: `${label} ${String(photoNo)}` }),
      })),
    });
    await writeFile(
      path.join(root, "data", "groups", "meme", "jomok.json"),
      JSON.stringify({
        schemaVersion: 1,
        pool: "meme",
        group: { id: "jomok", name: "Jomok", badge: "MEME" },
        members: [member("katak-bijak", "Katak Bijak")],
      }),
    );
    await writeFile(
      path.join(root, "data", "groups", "pejabat", "kurasi.json"),
      JSON.stringify({
        schemaVersion: 1,
        pool: "pejabat",
        group: { id: "kurasi", name: "Kurasi", badge: "KURASI" },
        members: [member("aynid-morbulet", null)],
      }),
    );
    const rawDir = path.join(root, "assets", "raw");
    await mkdir(rawDir, { recursive: true });
    const cardIds = ["katak-bijak", "aynid-morbulet"].flatMap((m) =>
      [1, 2, 3].map((n) => `${m}-0${String(n)}`),
    );
    for (const cardId of cardIds) {
      await writeFile(path.join(rawDir, `${cardId}.png`), Buffer.from([137, 80, 78, 71]));
    }
    const lock = {
      cards: Object.fromEntries(cardIds.map((id, i) => [id, i + 1])),
      pools: { meme: 3, pejabat: 6 },
    };
    const { inputs } = await collectCardInputs(root, lock);
    const jomok = inputs.filter((i) => i.cardId.startsWith("katak-bijak-"));
    expect(jomok.length).toBe(3);
    for (const input of jomok) {
      expect(input.photoLabel).toBeTypeOf("string");
    }
    const nonJomok = inputs.filter((i) => !i.cardId.startsWith("katak-bijak-"));
    expect(nonJomok.length).toBe(3);
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
