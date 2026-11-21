import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cardFileExtension, registerFonts } from "./lib/build-cards.js";
import { resolveManifestRoot } from "./lib/manifests.js";
import {
  renderFileName,
  renderPool,
  wranglerR2Upload,
  type RenderCard,
  type RenderUpdate,
} from "./lib/render-pool.js";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

function wranglerBin(): { cmd: string; preArgs: string[] } {
  // .cmd shims cannot be spawned arg-safely on Windows (shell quoting mangles
  // SQL), so run the real bin/wrangler.js via node directly, cross-platform.
  const pkgDir = path.dirname(fileURLToPath(import.meta.resolve("wrangler/package.json")));
  return { cmd: process.execPath, preArgs: [path.join(pkgDir, "bin", "wrangler.js")] };
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
  pool_id: string;
}

async function d1Exec(root: string, d1Args: string[], args: string[]): Promise<string> {
  const { cmd, preArgs } = wranglerBin();
  const { stdout } = await execFileAsync(cmd, [...preArgs, "d1", "execute", ...d1Args, ...args], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function d1Json(root: string, d1Args: string[], sql: string): Promise<RemoteCard[]> {
  const out = await d1Exec(root, d1Args, ["--json", "--command", sql]);
  const parsed = JSON.parse(out) as Array<{ results: RemoteCard[] }>;
  return parsed.flatMap((p) => p.results);
}

function flagValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${name}=`));
  return arg?.slice(name.length + 1);
}

async function loadOnlyIds(onlyFile: string): Promise<Set<string>> {
  const raw = await readFile(onlyFile, "utf8");
  return new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean));
}

/**
 * Render kartu foto-mentah -> upload webp ke R2 -> update D1 image_file.
 * R2 persistent: tidak kena prune buildAllCards, tidak hilang pindah mesin.
 * Filter opsional: --only=id1,id2 atau --only-file=path (tanpa itu = semua remote).
 * Paralel: --jobs=N (default 4), --gap-ms, --flush-every=N, --max-429=N.
 */
async function main(): Promise<void> {
  const root = resolveManifestRoot();
  const only = new Set(
    (flagValue("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const onlyFile = flagValue("--only-file");
  if (onlyFile !== undefined) {
    for (const id of await loadOnlyIds(onlyFile)) only.add(id);
  }
  const bucket = flagValue("--bucket") ?? "gatchawek-cards";
  const remote = process.argv.includes("--remote");

  const jobs = Number(flagValue("--jobs") ?? "4");
  const gapMs = Number(flagValue("--gap-ms") ?? "2000");
  const flushEvery = Number(flagValue("--flush-every") ?? "25");
  const max429 = Number(flagValue("--max-429") ?? "3");
  const cooldownMs = Number(flagValue("--cooldown-ms") ?? "60000");

  const d1Args = remote ? ["DB", "--remote"] : ["DB", "--local"];
  let rows = await d1Json(
    root,
    d1Args,
    "SELECT c.id, c.member_id, m.name AS member_name, c.group_id, g.badge, c.rarity, c.serial, c.photo_no, m.photo_total, c.photo_label, c.image_file, c.pool_id FROM cards c JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id WHERE c.image_file LIKE 'http%' AND c.enabled = 1 AND c.pool_id != 'pejabat'",
  );
  if (only.size > 0) rows = rows.filter((r) => only.has(r.id));
  if (only.size > 0 && rows.length === 0) {
    // Prioritas yang D1-nya sudah lokal tapi file-nya hilang (kasus prune):
    // ambil URL asli dari antrean inject.
    const ids = [...only].map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
    rows = await d1Json(
      root,
      d1Args,
      `SELECT c.id, c.member_id, m.name AS member_name, c.group_id, g.badge, c.rarity, c.serial, c.photo_no, m.photo_total, c.photo_label, q.image_url AS image_file, c.pool_id FROM cards c JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id JOIN inject_queue q ON q.nama IS NOT NULL AND q.member_id = c.member_id AND q.status = 'approved' WHERE c.pool_id != 'pejabat' AND c.id IN (${ids}) GROUP BY c.id`,
    );
    rows = rows.filter((r) => only.has(r.id));
    console.log(`fallback queue-url cards: ${String(rows.length)}`);
  }
  if (only.size > 0 && rows.length === 0) {
    // Kartu sudah static tapi Sumber-nya URL file mentah: render ulang dari sana.
    // URL non-gambar ditolak aman oleh validasi content-type saat fetch.
    const ids = [...only].map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
    rows = await d1Json(
      root,
      d1Args,
      `SELECT c.id, c.member_id, m.name AS member_name, c.group_id, g.badge, c.rarity, c.serial, c.photo_no, m.photo_total, c.photo_label, c.source_page_url AS image_file, c.pool_id FROM cards c JOIN members m ON m.id = c.member_id JOIN groups g ON g.id = c.group_id WHERE c.pool_id != 'pejabat' AND c.enabled = 1 AND c.source_page_url LIKE 'http%' AND c.id IN (${ids}) GROUP BY c.id`,
    );
    rows = rows.filter((r) => only.has(r.id));
    console.log(`fallback source-url cards: ${String(rows.length)}`);
  }
  if (rows.length === 0) return;

  registerFonts(path.join(SCRIPTS_DIR, "fonts"));
  const rawDir = path.join(root, "assets", "raw");
  await mkdir(rawDir, { recursive: true });

  const wrangler = wranglerBin();
  const cards: RenderCard[] = rows.map((r) => ({
    id: r.id,
    badge: r.badge,
    memberName: r.member_name,
    photoLabel: r.photo_label,
    fullName: null,
    rarity: r.rarity,
    serial: r.serial,
    photoNo: r.photo_no,
    photoTotal: r.photo_total,
    imageUrl: r.image_file,
  }));

  async function flushUpdates(batch: RenderUpdate[]): Promise<void> {
    const tmpDir = await mkdtemp(path.join(tmpdir(), "gatchawek-r2sql-"));
    try {
      const sql = batch
        .map((u) => `UPDATE cards SET image_file = ${sqlText(u.fileName)} WHERE id = ${sqlText(u.cardId)};`)
        .join("\n");
      const tmpFile = path.join(tmpDir, "render.sql");
      await writeFile(tmpFile, `${sql}\n`);
      await d1Exec(root, d1Args, ["--file", tmpFile]);
      console.log(`flushed ${String(batch.length)} card(s) to D1`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  const rarityById = new Map(cards.map((c) => [c.id, c.rarity]));

  const result = await renderPool(
    cards,
    {
      rawDir,
      upload: async (cardId, buffer) => {
        const ext = cardFileExtension(rarityById.get(cardId) ?? "");
        const fileName = renderFileName(cardId, buffer, ext);
        await wranglerR2Upload(root, wrangler, bucket, fileName, buffer);
        return fileName;
      },
      flushUpdates,
      onBuilt: (cardId, fileName) => console.log(`built+uploaded ${fileName} (${cardId})`),
      onSkipped: (cardId, reason) => console.warn(`warning: skipping ${cardId}: ${reason}`),
    },
    { jobs, gapMs, cooldownMs, flushEvery, max429 },
  );

  console.log(
    `done: updated ${String(result.updated)} card(s), failed ${String(result.failed.length)}${result.stopped429 ? " (429 breaker tripped)" : ""}`,
  );
  if (result.failed.length > 0) {
    console.warn(`failed ${String(result.failed.length)}:\n${result.failed.join("\n")}`);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  await main();
}
