import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approve } from "../scripts/approve.js";
import { loadManifests } from "../scripts/lib/manifests.js";
let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

const POOLS = [
  { id: "pejabat", name: "Pejabat", emoji: "🏛️", staminaMax: 10, regenIntervalSec: 1500, resetCooldownSec: 10800, sortOrder: 0 },
  { id: "meme", name: "Jomok", emoji: "🐸", staminaMax: 10, regenIntervalSec: 1500, resetCooldownSec: 10800, sortOrder: 1 },
];

function photo(photoNo: number): Record<string, unknown> {
  return {
    photoNo,
    rarity: "common",
    imageUrl: "https://example.com/wiki/foto",
    sourcePageUrl: "https://example.com/wiki/foto",
    license: null,
    author: null,
  };
}

function curatedGroup(pool: string, id: string, members: { id: string; name: string; count: number }[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    pool,
    group: { id, name: id, badge: "KURASI" },
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      photos: Array.from({ length: m.count }, (_, i) => photo(i + 1)),
    })),
  };
}

async function makeRoot(extraMembers: { id: string; name: string; count: number }[] = []): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gatchawek-approve-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "groups", "pejabat"), { recursive: true });
  await writeFile(path.join(root, "data", "pools.json"), JSON.stringify(POOLS));
  await writeFile(
    path.join(root, "data", "groups", "pejabat", "kabinet-merah-putih.json"),
    JSON.stringify(
      curatedGroup("pejabat", "kabinet-merah-putih", [
        { id: "aynid-morbulet", name: "Aynid Morbulet", count: 3 },
        ...extraMembers,
      ]),
    ),
  );
  await mkdir(path.join(root, "data", "submissions", "pending"), { recursive: true });
  return root;
}

function pendingMessage(
  messageId: string,
  submission: Record<string, unknown>,
): Record<string, unknown> {
  return {
    messageId,
    channelId: "222",
    guildId: "111",
    authorId: "900",
    messageUrl: `https://discord.com/channels/111/222/${messageId}`,
    submission: {
      nama: "Aynid Morbulet",
      memberId: "aynid-morbulet",
      pool: "pejabat",
      grup: "kabinet-merah-putih",
      rarity: "rare",
      label: null,
      sumber: `https://discord.com/channels/111/222/${messageId}`,
      imageUrl: "https://cdn.discordapp.net/attachments/1/2/foto.png",
      ...submission,
    },
  };
}

async function writePending(root: string, messageId: string, submission: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    path.join(root, "data", "submissions", "pending", `${messageId}.json`),
    JSON.stringify(pendingMessage(messageId, submission)),
  );
}

async function placeManualRaw(root: string, cardId: string): Promise<void> {
  const rawDir = path.join(root, "assets", "raw");
  await mkdir(rawDir, { recursive: true });
  await writeFile(path.join(rawDir, `${cardId}.png`), Buffer.from([137, 80, 78, 71]));
}

describe("approve", () => {
  it("appends sequential photoNos to an existing curated member", async () => {
    const root = await makeRoot();
    await writePending(root, "100");
    await placeManualRaw(root, "aynid-morbulet-04");
    const first = await approve(root, { messageId: "100", skipFetch: true });
    expect(first.memberId).toBe("aynid-morbulet");
    expect(first.photoNo).toBe(4);
    expect(first.groupFile).toBe(path.join("data", "groups", "pejabat", "kabinet-merah-putih.json"));

    await writePending(root, "101");
    await placeManualRaw(root, "aynid-morbulet-05");
    const second = await approve(root, { messageId: "101", skipFetch: true });
    expect(second.photoNo).toBe(5);

    const loaded = await loadManifests(root);
    expect(loaded.groups).toHaveLength(1);
    const member = loaded.groups[0]?.manifest.members.find((m) => m.id === "aynid-morbulet");
    expect(member?.photos.map((p) => p.photoNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it("creates a new member from a single photo", async () => {
    const root = await makeRoot();
    await writePending(root, "120", { nama: "Citra Lestari", memberId: "citra-lestari" });
    await placeManualRaw(root, "citra-lestari-01");
    const result = await approve(root, { messageId: "120", skipFetch: true });
    expect(result.memberId).toBe("citra-lestari");
    expect(result.photoNo).toBe(1);
    const loaded = await loadManifests(root);
    const member = loaded.groups[0]?.manifest.members.find((m) => m.id === "citra-lestari");
    expect(member?.photos.map((p) => p.photoNo)).toEqual([1]);
  });

  it("rejects a submission grup that does not match the pool", async () => {
    const root = await makeRoot();
    await writePending(root, "130", { grup: "jomok" });
    await expect(approve(root, { messageId: "130", skipFetch: true })).rejects.toThrow(
      /submission grup "jomok" does not match pool "pejabat" \(must be kabinet-merah-putih\)/,
    );
  });

  it("rejects a --pool override that conflicts with the submission pool", async () => {
    const root = await makeRoot();
    await writePending(root, "140");
    await expect(
      approve(root, { messageId: "140", pool: "meme", skipFetch: true }),
    ).rejects.toThrow(/--pool meme conflicts with submission pool "pejabat"/);
  });

  it("defaults to pejabat for old pendings without a pool field", async () => {
    const root = await makeRoot();
    const legacy = pendingMessage("150", {});
    delete (legacy.submission as Record<string, unknown>).pool;
    await writeFile(
      path.join(root, "data", "submissions", "pending", "150.json"),
      JSON.stringify(legacy),
    );
    await placeManualRaw(root, "aynid-morbulet-04");
    const result = await approve(root, { messageId: "150", skipFetch: true });
    expect(result.photoNo).toBe(4);
  });

  it("rejects a slug collision owned by another file", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "data", "groups", "meme"), { recursive: true });
    await writeFile(
      path.join(root, "data", "groups", "meme", "jomok.json"),
      JSON.stringify(
        curatedGroup("meme", "jomok", [{ id: "katak-bijak", name: "Katak Bijak", count: 3 }]),
      ),
    );
    await writePending(root, "160", { nama: "Katak Bijak", memberId: "katak-bijak" });
    await expect(approve(root, { messageId: "160", skipFetch: true })).rejects.toThrow(
      /already exists in data.groups.meme.jomok\.json/,
    );
  });

  it("rejects when the target file belongs to a different pool", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "data", "groups", "pejabat", "kabinet-merah-putih.json"),
      JSON.stringify(
        curatedGroup("meme", "kabinet-merah-putih", [
          { id: "aynid-morbulet", name: "Aynid Morbulet", count: 3 },
        ]),
      ),
    );
    await writePending(root, "170");
    await expect(approve(root, { messageId: "170", skipFetch: true })).rejects.toThrow(
      /belongs to pool "meme", not "pejabat"/,
    );
  });

  it("errors loudly when the target group file is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gatchawek-approve-"));
    roots.push(root);
    await mkdir(path.join(root, "data", "groups", "pejabat"), { recursive: true });
    await mkdir(path.join(root, "data", "submissions", "pending"), { recursive: true });
    await writeFile(path.join(root, "data", "pools.json"), JSON.stringify(POOLS));
    await writePending(root, "180");
    await expect(approve(root, { messageId: "180", skipFetch: true })).rejects.toThrow(
      /target group file .*kabinet-merah-putih\.json not found; repo groups changed, update POOL_GROUPS/,
    );
  });

  it("requires a manual raw file in skip-fetch mode", async () => {
    const root = await makeRoot();
    await writePending(root, "190");
    await expect(approve(root, { messageId: "190", skipFetch: true })).rejects.toThrow(
      /no manual file for aynid-morbulet-04/,
    );
    // Still pending after failure.
    expect(await readdir(path.join(root, "data", "submissions", "pending"))).toEqual(["190.json"]);
  });
});
