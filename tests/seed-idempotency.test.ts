import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadImage } from "@napi-rs/canvas";
import { collectCardInputs } from "../scripts/lib/card-inputs.js";

const execAsync = promisify(exec);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HAS_ASSETS = existsSync(path.join(REPO_ROOT, "assets"));

let fixture = "";
let persistDir = "";
let env: NodeJS.ProcessEnv = {};

async function wranglerD1(args: string): Promise<unknown[]> {
  const { stdout } = await execAsync(
    `pnpm exec wrangler d1 execute DB ${args} --persist-to "${persistDir}" --json`,
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, env },
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("unexpected D1 JSON shape");
  return parsed.flatMap((r: unknown) => {
    if (typeof r !== "object" || r === null || !("results" in r)) return [];
    return Array.isArray(r.results) ? r.results : [];
  });
}

async function runSeed(): Promise<string> {
  const tsxPath = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const { stdout } = await execAsync(
    `"${process.execPath}" "${tsxPath}" scripts/seed.ts`,
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, env },
  );
  return stdout;
}
 async function tableCounts(): Promise<Record<string, number>> {
   const counts: Record<string, number> = {};
   const queries: Record<string, string> = {
     pools: "SELECT COUNT(*) n FROM pools",
     groups: "SELECT COUNT(*) n FROM groups",
     members: "SELECT COUNT(*) n FROM members",
     cards: "SELECT COUNT(*) n FROM cards",
     groups_live: "SELECT COUNT(*) n FROM groups WHERE enabled=1",
     members_live: "SELECT COUNT(*) n FROM members WHERE enabled=1",
     cards_live: "SELECT COUNT(*) n FROM cards WHERE enabled=1",
   };
   for (const [key, command] of Object.entries(queries)) {
     const rows: unknown[] = await wranglerD1(`--local --command "${command}"`);
     const [row]: unknown[] = rows;
     if (
       typeof row !== "object" ||
       row === null ||
       !("n" in row) ||
       typeof row.n !== "number"
     ) {
       throw new Error("unexpected D1 row shape");
     }
     counts[key] = row.n;
   }
   return counts;
 }

beforeAll(async () => {
  if (!HAS_ASSETS) return;
  fixture = await mkdtemp(path.join(tmpdir(), "gatchawek-seed-"));
  for (const dir of ["data", "assets"]) {
    await cp(path.join(REPO_ROOT, dir), path.join(fixture, dir), {
      recursive: true,
    });
  }
  // Scratch D1 state: the repo-local .wrangler/state accumulates rows from
  // older datasets, so counts here must start from a migrated empty DB.
  persistDir = await mkdtemp(path.join(tmpdir(), "gatchawek-seed-d1-"));
  env = { ...process.env, MANIFEST_ROOT: fixture, SEED_PERSIST_TO: persistDir };
  await execAsync(
    `pnpm exec wrangler d1 migrations apply DB --local --persist-to "${persistDir}"`,
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, env },
  );
}, 180_000);

afterAll(async () => {
  if (!HAS_ASSETS) return;
  await rm(fixture, { recursive: true, force: true });
  await rm(persistDir, { recursive: true, force: true });
}, 300_000);

describe.skipIf(!HAS_ASSETS)("seed idempotency", () => {
  it("two seeds produce identical rows, serials, and files", async () => {
    await runSeed();
    const counts1 = await tableCounts();
    const lock1 = await readFile(
      path.join(fixture, "data", "serials.lock.json"),
      "utf8",
    );
    const { readdir } = await import("node:fs/promises");
    const files1 = (await readdir(path.join(fixture, "public", "cards"))).sort();

    await runSeed();
    const counts2 = await tableCounts();
    const lock2 = await readFile(
      path.join(fixture, "data", "serials.lock.json"),
      "utf8",
    );
    const files2 = (await readdir(path.join(fixture, "public", "cards"))).sort();

    // Expectations derive from the fixture dataset and its raw assets. Both
    // drift (photos get added or dropped, raw images live outside git), so a
    // literal count turns that drift into a false alarm.
    const { loaded, inputs } = await collectCardInputs(fixture);
    const memberCount = loaded.groups.reduce(
      (n, g) => n + g.manifest.members.length,
      0,
    );
    const liveMemberCount = loaded.groups.reduce(
      (n, g) => n + g.manifest.members.filter((m) => m.enabled).length,
      0,
    );
    expect(counts1.pools).toBe(loaded.pools.length);
    expect(counts1.groups).toBe(loaded.groups.length);
    expect(counts1.groups_live).toBe(loaded.groups.length);
    expect(counts1.members).toBe(memberCount);
    expect(counts1.members_live).toBe(liveMemberCount);
    // One row per card that has a raw image; nothing else is inserted.
    expect(counts1.cards_live).toBe(inputs.length);
    expect(counts1.cards).toBeGreaterThanOrEqual(inputs.length);
    expect(counts2).toEqual(counts1);
    expect(lock2).toBe(lock1);
    expect(files2).toEqual(files1);
    expect(files1).toHaveLength(inputs.length);
  }, 300_000);

  it("removing a photo disables the card and prunes its file", async () => {
    const manifestPath = path.join(
      fixture,
      "data",
      "groups",
      "meme",
      "jomok.json",
    );
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("members" in parsed) ||
      !Array.isArray(parsed.members)
    ) {
      throw new Error("fixture manifest has unexpected shape");
    }
    const [firstMember]: unknown[] = parsed.members;
    if (
      typeof firstMember !== "object" ||
      firstMember === null ||
      !("photos" in firstMember) ||
      !Array.isArray(firstMember.photos)
    ) {
      throw new Error("fixture manifest has unexpected shape");
    }
    expect(firstMember.photos).toHaveLength(6);
    const photos: unknown[] = firstMember.photos;
    const thirdPhoto: unknown = photos[2];
    if (typeof thirdPhoto !== "object" || thirdPhoto === null) {
      throw new Error("fixture manifest has unexpected shape");
    }
    photos[2] = { ...thirdPhoto, enabled: false };
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(manifestPath, JSON.stringify(parsed, null, 2)),
    );
    await runSeed();

    const rows: unknown[] = await wranglerD1(
      `--local --command "SELECT id, enabled FROM cards WHERE id='jomok-mix-01-03'"`,
    );
    expect(rows).toHaveLength(1);
    const [row]: unknown[] = rows;
    if (
      typeof row !== "object" ||
      row === null ||
      !("enabled" in row) ||
      typeof row.enabled !== "number"
    ) {
      throw new Error("unexpected D1 row shape");
    }
    expect(row.enabled).toBe(0);

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(path.join(fixture, "public", "cards"));
    expect(files.filter((f) => f.startsWith("jomok-mix-01-03."))).toHaveLength(0);
  }, 300_000);

  it("every built frame is 600x900 and under 150KB", async () => {
    const { readdir, stat } = await import("node:fs/promises");
    const dir = path.join(fixture, "public", "cards");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".webp"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const image = await loadImage(path.join(dir, file));
      const size = (await stat(path.join(dir, file))).size;
      expect([image.width, image.height]).toEqual([600, 900]);
      expect(size).toBeLessThan(150 * 1024);
    }
  }, 120_000);
});
