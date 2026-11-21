import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCardImage,
  cardFileExtension,
  registerFonts,
} from "./lib/build-cards.js";
import { fetchRemoteImage } from "./fetch-images.js";
import { resolveManifestRoot } from "./lib/manifests.js";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

async function sh(cmd: string, cwd: string): Promise<string> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  const { stdout } = await execAsync(cmd, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function wranglerBin(root: string): string {
  return path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
}

function sqlText(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

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

async function d1Json(root: string, d1Args: string[], sql: string): Promise<RemoteCard[]> {
  const quoted = [...d1Args, "--json", "--command", sql]
    .map((a) => `"${a.replace(/"/g, '\\"')}"`)
    .join(" ");
  const out = await sh(`"${wranglerBin(root)}" d1 execute ${quoted}`, root);
  const parsed = JSON.parse(out) as Array<{ results: RemoteCard[] }>;
  return parsed.flatMap((p) => p.results);
}

/**
 * Render kartu foto-mentah -> upload webp ke R2 -> update D1 image_file.
 * R2 persistent: tidak kena prune buildAllCards, tidak hilang pindah mesin.
 * Filter opsional: --only=id1,id2 (tanpa itu = semua remote).
 */
async function main(): Promise<void> {
  const root = resolveManifestRoot();
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = new Set(
    (onlyArg?.split("=")[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const bucketArg = process.argv.find((a) => a.startsWith("--bucket="));
  const bucket = bucketArg?.split("=")[1] ?? "gatchawek-cards";
  const remote = process.argv.includes("--remote");

  const d1Args = remote ? ["DB", "--remote"] : ["DB", "--local"];
  let rows = await d1Json(
    root,
    d1Args,
    "SELECT c.id, c.member_id, m.name AS member_name, c.group_id, g.badge, c.rarity, c.serial, c.photo_no, m.photo_total, c.photo_label, c.image_file FROM cards c JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id WHERE c.image_file LIKE 'http%' AND c.enabled = 1",
  );
  if (only.size > 0) rows = rows.filter((r) => only.has(r.id));
  if (only.size > 0 && rows.length === 0) {
    // Prioritas yang D1-nya sudah lokal tapi file-nya hilang (kasus prune):
    // ambil URL asli dari antrean inject.
    const ids = [...only].map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
    rows = await d1Json(
      root,
      d1Args,
      `SELECT c.id, c.member_id, m.name AS member_name, c.group_id, g.badge, c.rarity, c.serial, c.photo_no, m.photo_total, c.photo_label, q.image_url AS image_file FROM cards c JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id JOIN inject_queue q ON q.nama IS NOT NULL AND q.member_id = c.member_id AND q.status = 'approved' WHERE c.id IN (${ids}) GROUP BY c.id`,
    );
    rows = rows.filter((r) => only.has(r.id));
    console.log(`fallback queue-url cards: ${String(rows.length)}`);
  }
  if (rows.length === 0) return;

  registerFonts(path.join(SCRIPTS_DIR, "fonts"));
  const rawDir = path.join(root, "assets", "raw");
  await mkdir(rawDir, { recursive: true });

  const gapMs = Number(
    process.argv.find((a) => a.startsWith("--gap-ms="))?.split("=")[1] ?? "15000",
  );
  const { setTimeout: delay } = await import("node:timers/promises");
  const updates: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r === undefined) continue;
    if (i > 0 && Number.isFinite(gapMs) && gapMs > 0) await delay(gapMs);
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
    const ext = cardFileExtension(r.rarity);
    const fileName = `${r.id}.${hash}.${ext}`;
    const contentType = ext === "gif" ? "image/gif" : "image/webp";
    // R2 object put via temp file (binary-safe; avoids shell quoting).
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tmpDir = await mkdtemp(path.join(tmpdir(), "gatchawek-r2-"));
    try {
      const tmpFile = path.join(tmpDir, fileName);
      await writeFile(tmpFile, buffer);
      await sh(
        `"${wranglerBin(root)}" r2 object put ${bucket}/${fileName} --file "${tmpFile}" --content-type ${contentType} --remote`,
        root,
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
    updates.push(
      `UPDATE cards SET image_file = ${sqlText(fileName)} WHERE id = ${sqlText(r.id)};`,
    );
    console.log(`built+uploaded ${fileName}`);
  }
  if (updates.length > 0) {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const tmpDir = await mkdtemp(path.join(tmpdir(), "gatchawek-r2sql-"));
    const tmpFile = path.join(tmpDir, "render.sql");
    await writeFile(tmpFile, `${updates.join("\n")}\n`);
    try {
      const quoted = [...d1Args, "--file", tmpFile]
        .map((a) => `"${a.replace(/"/g, '\\"')}"`)
        .join(" ");
      await sh(`"${wranglerBin(root)}" d1 execute ${quoted}`, root);
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
