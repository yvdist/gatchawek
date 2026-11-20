import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadManifests, photoWarnings, summarize } from "../scripts/lib/manifests.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let roots: string[] = [];

afterEach(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
  roots = [];
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gatchawek-manifest-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "groups", "pejabat"), { recursive: true });
  return root;
}

interface PhotoDraft {
  photoNo: number;
  rarity: string;
  imageUrl: string;
  sourcePageUrl: string;
  license: null;
  author: null;
}

interface GroupDraft {
  schemaVersion: number;
  pool: string;
  group: { id: string; name: string; badge: string };
  members: {
    id: string;
    name: string;
    fullName: string;
    photos: PhotoDraft[];
  }[];
}

const GOOD_POOLS = [
  {
    id: "pejabat",
    name: "Pejabat",
    emoji: "🏛️",
    staminaMax: 10,
    regenIntervalSec: 1500,
    resetCooldownSec: 10800,
    sortOrder: 0,
  },
];

function goodGroup(pool = "pejabat", memberId = "tokoh-satu"): GroupDraft {
  return {
    schemaVersion: 1,
    pool,
    group: { id: "grup-satu", name: "Grup Satu", badge: "GRUP" },
    members: [
      {
        id: memberId,
        name: "Tokoh Satu",
        fullName: "Tokoh Satu Penuh",
        photos: [1, 2, 3].map((photoNo) => ({
          photoNo,
          rarity: "common",
          imageUrl: "color:#9CA3AF",
          sourcePageUrl: "https://example.com/wiki/foto",
          license: null,
          author: null,
        })),
      },
    ],
  };
}

async function writeManifests(
  root: string,
  pools: unknown,
  groups: { dir: string; file: string; body: unknown }[],
): Promise<void> {
  await writeFile(path.join(root, "data", "pools.json"), JSON.stringify(pools));
  for (const g of groups) {
    await mkdir(path.join(root, "data", "groups", g.dir), { recursive: true });
    await writeFile(
      path.join(root, "data", "groups", g.dir, g.file),
      JSON.stringify(g.body),
    );
  }
}

describe("manifest validation", () => {
  it("rejects a bad rarity value with file and field named", async () => {
    const root = await makeRoot();
    const broken = goodGroup();
    const firstMember = broken.members[0];
    expect(firstMember).toBeDefined();
    if (firstMember !== undefined) {
      const firstPhoto = firstMember.photos[0];
      expect(firstPhoto).toBeDefined();
      if (firstPhoto !== undefined) firstPhoto.rarity = "legendary";
    }
    await writeManifests(root, GOOD_POOLS, [
      { dir: "pejabat", file: "grup-satu.json", body: broken },
    ]);
    await expect(loadManifests(root)).rejects.toThrow(
      /grup-satu\.json.*rarity/,
    );
  });

  it("rejects a photoNo gap with member named", async () => {
    const root = await makeRoot();
    const broken = goodGroup();
    const firstMember = broken.members[0];
    expect(firstMember).toBeDefined();
    if (firstMember !== undefined) {
      const thirdPhoto = firstMember.photos[2];
      expect(thirdPhoto).toBeDefined();
      if (thirdPhoto !== undefined) thirdPhoto.photoNo = 4;
    }
    await writeManifests(root, GOOD_POOLS, [
      { dir: "pejabat", file: "grup-satu.json", body: broken },
    ]);
    await expect(loadManifests(root)).rejects.toThrow(/tokoh-satu.*photoNo/);
  });

  it("rejects a duplicate member id across files", async () => {
    const root = await makeRoot();
    await writeManifests(root, GOOD_POOLS, [
      { dir: "pejabat", file: "grup-a.json", body: goodGroup() },
      { dir: "pejabat", file: "grup-b.json", body: goodGroup() },
    ]);
    await expect(loadManifests(root)).rejects.toThrow(
      /duplicate member id "tokoh-satu"/,
    );
  });

  it("accepts a single-photo member and warns instead of failing", async () => {
    const root = await makeRoot();
    const single = goodGroup();
    const firstMember = single.members[0];
    expect(firstMember).toBeDefined();
    if (firstMember !== undefined) firstMember.photos.splice(1);
    await writeManifests(root, GOOD_POOLS, [
      { dir: "pejabat", file: "grup-satu.json", body: single },
    ]);
    const loaded = await loadManifests(root);
    expect(loaded.groups).toHaveLength(1);
    expect(photoWarnings(loaded)).toHaveLength(1);
    expect(photoWarnings(loaded)[0]).toMatch(/member "tokoh-satu" has 1 photo\(s\), ideally at least 3/);
  });

  it("emits no photo warning for a complete 3-photo member", async () => {
    const root = await makeRoot();
    await writeManifests(root, GOOD_POOLS, [
      { dir: "pejabat", file: "grup-satu.json", body: goodGroup() },
    ]);
    const loaded = await loadManifests(root);
    expect(photoWarnings(loaded)).toEqual([]);
  });

  it("accepts the curated dataset and summarizes 2 groups", async () => {
    const loaded = await loadManifests(REPO_ROOT);
    expect(loaded.pools.map((p) => p.id).sort()).toEqual(["meme", "pejabat"]);
    expect(loaded.groups).toHaveLength(2);
    const summary = summarize(loaded).join("\n");
    expect(summary).toMatch(/pejabat\/kabinet-merah-putih: 72 member, 72 foto/);
    expect(summary).toMatch(/meme\/jomok: 18 member, 108 foto/);
  });
});
