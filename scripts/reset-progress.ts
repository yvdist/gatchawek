/**
 * Reset seluruh progres koleksi semua user ke 0 dan kembalikan stamina penuh.
 *
 * Menghapus: user_cards, pulls, trades (semua), battles (semua).
 * Mereset: user_pool_states -> stamina penuh, anchor = now,
 *   last_reset_at = NULL (cooldown dibuka), version + 1, pity_wish = 0.
 * users dibiarkan (identitas Discord tetap).
 *
 * Katalog (pools/groups/members/cards) TIDAK disentuh.
 *
 * Usage:
 *   pnpm reset:progress           # local D1
 *   pnpm reset:progress:remote    # remote D1 (tidak bisa undo)
 */
import { exec as execCb } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as path from "node:path";

const execAsync = promisify(execCb);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: readonly string[]): {
  remote: boolean;
  env: string | null;
  yes: boolean;
} {
  const remote = argv.includes("--remote");
  const envFlag = argv.indexOf("--env");
  const env =
    envFlag >= 0 && envFlag + 1 < argv.length
      ? (argv[envFlag + 1] as string)
      : null;
  return { remote, env, yes: argv.includes("--yes") };
}

async function d1Execute(
  sql: string,
  target: { remote: boolean; env: string | null },
): Promise<void> {
  const wranglerBin = path.join(
    SCRIPTS_DIR,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  const scope =
    target.env !== null
      ? `DB --env ${target.env} --remote`
      : target.remote
        ? "DB --remote"
        : "DB --local";
  const escaped = sql.replace(/"/g, '\\"');
  await execAsync(`"${wranglerBin}" d1 execute ${scope} --command "${escaped}"`, {
    cwd: path.join(SCRIPTS_DIR, ".."),
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function main(): Promise<void> {
  const target = parseArgs(process.argv.slice(2));
  const where = target.env ?? (target.remote ? "remote" : "local");
  if (!target.yes) {
    console.error(
      `Refusing: this wipes ALL user progress on ${where} D1. Re-run with --yes.`,
    );
    process.exit(1);
  }
  const now = Date.now();
  const statements = [
    "DELETE FROM user_cards;",
    "DELETE FROM pulls;",
    "DELETE FROM trades;",
    "DELETE FROM battles;",
    // Stamina penuh per pool + cooldown dibuka + pity nol. anchor = now agar
    // tidak ada regen tertunda yang bocor dari era sebelum reset.
    `UPDATE user_pool_states SET stamina = (SELECT stamina_max FROM pools WHERE pools.id = user_pool_states.pool_id), stamina_anchor_at = ${now}, last_reset_at = NULL, version = version + 1, pity_wish = 0;`,
  ];
  for (const sql of statements) {
    await d1Execute(sql, target);
    console.log(`ok: ${sql.slice(0, 60)}`);
  }
  console.log(`progress reset done on ${where} D1 (anchor=${now}).`);
}

const invokedAsMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsMain) {
  await main();
}
