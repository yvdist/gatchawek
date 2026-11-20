import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildCardImage, registerFonts } from "./lib/build-cards.js";
import { fetchRemoteImage } from "./fetch-images.js";
import { resolveManifestRoot } from "./lib/manifests.js";
import { resolveSeedTarget } from "./seed.js";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

interface RemoteCard {
  id: string;
  member_id: string;
  member_name: string;
  group_id: string;
  badge: string;
  rarity: string;
  serial: number;
  photo_no: number;
  photo_total: number;
  photo_label: string | null;
  image_file: string;
}

function sqlText(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

async function runWranglerJson(args: string[], cwd: string): Promise<unknown[]> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  const quoted = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
  const bin = path.join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  const { stdout } = await execAsync(`"${bin}" d1 execute ${quoted}`, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as Array<{ results: unknown[] }>;
  return parsed.flatMap((p) => p.results);
}

/**
 * Render bingkai kartu untuk kartu inject yang masih foto-mentah
 * (`image_file` URL remote). Alur: download raw -> buildCardImage ->
 * public/cards/<cardId>.<hash>.webp -> update D1 image_file.
 * Tanpa prune global: buildAllCards tidak dipakai supaya kartu lain aman.
 */
async function main(): Promise<void> {
  const root = resolveManifestRoot();
  const target = resolveSeedTarget();
  const d1Args = target.env !== null
    ? ["DB", "--env", target.env, "--remote"]
    : target.remote
      ? ["DB", "--remote"]
      : ["DB", "--local"];
  const rows = (await runWranglerJson(
    [...d1Args, "--json", "--command", "SELECT c.id, c.member_id, m.name AS member_name, c.group_id, g.badge, c.rarity, c.serial, c.photo_no, m.photo_total, c.photo_label, c.image_file FROM cards c JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id WHERE c.image_file LIKE 'http%' AND c.enabled = 1"],
    root,
  )) as RemoteCard[];
  console.log(`remote-image cards: ${String(rows.length)}`);
  if (rows.length === 0) return;

  registerFonts(path.join(SCRIPTS_DIR, "fonts"));
  const rawDir = path.join(root, "assets", "raw");
  const outDir = path.join(root, "public", "cards");
  await mkdir(rawDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const gapMs = Number(process.argv.find((a) => a.startsWith("--gap-ms="))?.split("=")[1] ?? "15000");
  const { setTimeout: delay } = await import("node:timers/promises");
  const updates: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r === undefined) continue;
    if (i > 0 && Number.isFinite(gapMs) && gapMs > 0) {
      await delay(gapMs);
    }
    let fetched = await fetchRemoteImage(r.id, r.image_file, rawDir);
    if (typeof fetched !== "string" && fetched.reason.includes("429")) {
      console.warn(`warning: ${r.id} rate-limited, retrying once after 60s...`);
      await delay(60_000);
      fetched = await fetchRemoteImage(r.id, r.image_file, rawDir);
    }
    if (typeof fetched !== "string") {
      failed.push(`${r.id}: ${fetched.reason}`);
      console.warn(`warning: skipping ${r.id}: ${fetched.reason}`);
      continue;
    }
    const buffer = await buildCardImage({
      cardId: r.id,
      badge: r.badge,
      memberName: r.member_name,
      photoLabel: r.photo_label,
      fullName: null,
      rarity: r.rarity,
      serial: r.serial,
      photoNo: r.photo_no,
      photoTotal: r.photo_total,
      rawPath: fetched,
      focusX: 0.5,
      focusY: 0.35,
    });
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
    const fileName = `${r.id}.${hash}.webp`;
    await writeFile(path.join(outDir, fileName), buffer);
    updates.push(
      `UPDATE cards SET image_file = ${sqlText(fileName)} WHERE id = ${sqlText(r.id)};`,
    );
    console.log(`built ${fileName}`);
  }
  if (updates.length > 0) {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tmpDir = await mkdtemp(path.join(tmpdir(), "gatchawek-render-"));
    const tmpFile = path.join(tmpDir, "render.sql");
    await writeFile(tmpFile, `${updates.join("\n")}\n`);
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      const quoted = [...d1Args, "--file", tmpFile]
        .map((a) => `"${a.replace(/"/g, '\\"')}"`)
        .join(" ");
      const wranglerBin = path.join(
        SCRIPTS_DIR,
        "..",
        "node_modules",
        ".bin",
        process.platform === "win32" ? "wrangler.cmd" : "wrangler",
      );
      await execAsync(`"${wranglerBin}" d1 execute ${quoted}`, {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      });
      console.log(`updated ${String(updates.length)} card(s) in D1`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
  if (failed.length > 0) {
    console.warn(`failed ${String(failed.length)}:\n${failed.join("\n")}`);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  await main();
}
