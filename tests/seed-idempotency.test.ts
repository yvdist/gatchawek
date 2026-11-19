import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadImage } from "@napi-rs/canvas";

const execAsync = promisify(exec);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let fixture = "";
let env: NodeJS.ProcessEnv = {};

async function wranglerD1(args: string): Promise<unknown[]> {
  const { stdout } = await execAsync(
    `pnpm exec wrangler d1 execute DB ${args} --json`,
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
  const rows: unknown[] = await wranglerD1(
    `--local --command "SELECT 'pools' t, COUNT(*) n FROM pools UNION ALL SELECT 'groups', COUNT(*) FROM groups UNION ALL SELECT 'members', COUNT(*) FROM members UNION ALL SELECT 'cards', COUNT(*) FROM cards"`,
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (
      typeof row !== "object" ||
      row === null ||
      !("t" in row) ||
      !("n" in row) ||
      typeof row.t !== "string" ||
      typeof row.n !== "number"
    ) {
      throw new Error("unexpected D1 row shape");
    }
    counts[row.t] = row.n;
  }
  return counts;
}

beforeAll(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "gatchawek-seed-"));
  for (const dir of ["data", "assets"]) {
    await cp(path.join(REPO_ROOT, dir), path.join(fixture, dir), {
      recursive: true,
    });
  }
  env = { ...process.env, MANIFEST_ROOT: fixture };
}, 120_000);

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
  // Fixture seeds apply to the repo local D1; restore canonical state.
  const tsxPath = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  await execAsync(`"${process.execPath}" "${tsxPath}" scripts/seed.ts`, {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
});

describe("seed idempotency", () => {
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

    expect(counts1).toEqual({ pools: 2, groups: 3, members: 7, cards: 21 });
    expect(counts2).toEqual(counts1);
    expect(lock2).toBe(lock1);
    expect(files2).toEqual(files1);
    expect(files1).toHaveLength(21);
  }, 300_000);

  it("removing a photo disables the card and prunes its file", async () => {
    const manifestPath = path.join(
      fixture,
      "data",
      "groups",
      "meme",
      "meme-klasik.json",
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
    expect(firstMember.photos).toHaveLength(3);
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
      `--local --command "SELECT id, enabled FROM cards WHERE id='katak-bijak-03'"`,
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
    expect(files.filter((f) => f.startsWith("katak-bijak-03."))).toHaveLength(0);
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
