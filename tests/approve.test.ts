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

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gatchawek-approve-"));
  roots.push(root);
  await mkdir(path.join(root, "data", "groups", "pejabat"), { recursive: true });
  await writeFile(path.join(root, "data", "pools.json"), JSON.stringify(POOLS));
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
  it("merges two same-name submissions into one member with photoNo 1,2", async () => {
    const root = await makeRoot();
    await writePending(root, "100");
    await placeManualRaw(root, "aynid-morbulet-01");
    const first = await approve(root, { messageId: "100", skipFetch: true });
    expect(first.memberId).toBe("aynid-morbulet");
    expect(first.photoNo).toBe(1);

    await writePending(root, "101");
    await placeManualRaw(root, "aynid-morbulet-02");
    const second = await approve(root, { messageId: "101", skipFetch: true });
    expect(second.memberId).toBe("aynid-morbulet");
    expect(second.photoNo).toBe(2);
    expect(second.groupFile).toBe(first.groupFile);

    const loaded = await loadManifests(root);
    expect(loaded.groups).toHaveLength(1);
    const member = loaded.groups[0]?.manifest.members[0];
    expect(member?.photos).toHaveLength(2);
    expect(member?.photos.map((p) => p.photoNo)).toEqual([1, 2]);
  });

  it("creates separate members for different names", async () => {
    const root = await makeRoot();
    await writePending(root, "200");
    await placeManualRaw(root, "aynid-morbulet-01");
    await approve(root, { messageId: "200", skipFetch: true });

    await writePending(root, "201", { nama: "Budi Santoso" });
    await placeManualRaw(root, "budi-santoso-01");
    await approve(root, { messageId: "201", skipFetch: true });

    const loaded = await loadManifests(root);
    const members = loaded.groups[0]?.manifest.members ?? [];
    expect(members.map((m) => m.id).sort()).toEqual(["aynid-morbulet", "budi-santoso"]);
  });

  it("rejects a slug collision owned by another file", async () => {
    const root = await makeRoot();
    // Pre-existing member in a curated group, same slug the submission generates.
    await writeFile(
      path.join(root, "data", "groups", "pejabat", "kurasi.json"),
      JSON.stringify({
        schemaVersion: 1,
        pool: "pejabat",
        group: { id: "kurasi", name: "Kurasi", badge: "KURASI" },
        members: [
          {
            id: "aynid-morbulet",
            name: "Aynid Morbulet",
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
      }),
    );
    // Submission lands in a *different* komunitas group file.
    await writePending(root, "300", { grup: "kelompok-lain" });

    await expect(approve(root, { messageId: "300", skipFetch: true })).rejects.toThrow(
      /already exists in data.groups.pejabat.kurasi\.json/,
    );
  });

  it("requires a manual raw file in skip-fetch mode", async () => {
    const root = await makeRoot();
    await writePending(root, "400");
    await expect(approve(root, { messageId: "400", skipFetch: true })).rejects.toThrow(
      /no manual file for aynid-morbulet-01/,
    );
    // Still pending after failure.
    expect(await readdir(path.join(root, "data", "submissions", "pending"))).toEqual(["400.json"]);
  });
});
