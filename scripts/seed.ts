import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { promisify } from "node:util";
import { buildAllCards, registerFonts } from "./lib/build-cards.js";
import {
  cardIdFor,
  collectCardInputs,
  EMPTY_LOCK,
  tryReadSerialsLock,
  type SerialsLock,
} from "./lib/card-inputs.js";
import {
  loadManifests,
  ManifestError,
  rarityWarnings,
  resolveManifestRoot,
  summarize,
} from "./lib/manifests.js";

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableText(value: string | null | undefined): string {
  return value === null || value === undefined ? "NULL" : sqlText(value);
}

/**
 * Assign serials to new cards: serial = max(pool) + 1. The lock is the
 * single source of truth; serials are never reused, even after takedown.
 */
export function assignSerials(
  pools: { id: string }[],
  cardPoolIds: Map<string, string>,
  prev: SerialsLock,
): SerialsLock {
  const next: SerialsLock = {
    cards: { ...prev.cards },
    pools: { ...prev.pools },
  };
  for (const pool of pools) {
    if (next.pools[pool.id] === undefined) next.pools[pool.id] = 0;
  }
  const sortedCardIds = [...cardPoolIds.keys()].sort();
  for (const cardId of sortedCardIds) {
    if (next.cards[cardId] !== undefined) continue;
    const poolId = cardPoolIds.get(cardId) as string;
    const serial = (next.pools[poolId] ?? 0) + 1;
    next.cards[cardId] = serial;
    next.pools[poolId] = serial;
  }
  return next;
}

/** Render the full seed SQL: FK order pools → groups → members → cards. */
export function renderSeedSql(
  loaded: Awaited<ReturnType<typeof loadManifests>>,
  builtFiles: Map<string, string>,
  lock: SerialsLock,
): string {
  const lines: string[] = ["PRAGMA foreign_keys=OFF;"];
  for (const pool of loaded.pools) {
    lines.push(
      `INSERT INTO pools (id, name, emoji, sort_order, stamina_max, regen_interval_sec, reset_cooldown_sec, member_count, enabled) VALUES (${sqlText(pool.id)}, ${sqlText(pool.name)}, ${sqlText(pool.emoji)}, ${pool.sortOrder}, ${pool.staminaMax}, ${pool.regenIntervalSec}, ${pool.resetCooldownSec}, 0, 1) ` +
        `ON CONFLICT(id) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, sort_order=excluded.sort_order, stamina_max=excluded.stamina_max, regen_interval_sec=excluded.regen_interval_sec, reset_cooldown_sec=excluded.reset_cooldown_sec, enabled=1;`,
    );
  }
  const poolMemberCount = new Map<string, number>();
  for (const { manifest } of loaded.groups) {
    poolMemberCount.set(
      manifest.pool,
      (poolMemberCount.get(manifest.pool) ?? 0) + manifest.members.length,
    );
    const gid = sqlText(manifest.group.id);
    lines.push(
      `INSERT INTO groups (id, pool_id, name, badge, sort_order, member_count, enabled) VALUES (${gid}, ${sqlText(manifest.pool)}, ${sqlText(manifest.group.name)}, ${sqlText(manifest.group.badge)}, 0, ${manifest.members.length}, 1) ` +
        `ON CONFLICT(id) DO UPDATE SET pool_id=excluded.pool_id, name=excluded.name, badge=excluded.badge, member_count=excluded.member_count, enabled=1;`,
    );
  }
  for (const { manifest } of loaded.groups) {
    for (const member of manifest.members) {
      lines.push(
        `INSERT INTO members (id, pool_id, group_id, name, name_lower, full_name, photo_total, sort_order, enabled) VALUES (${sqlText(member.id)}, ${sqlText(manifest.pool)}, ${sqlText(manifest.group.id)}, ${sqlText(member.name)}, ${sqlText(member.name.toLowerCase())}, ${sqlNullableText(member.fullName)}, ${member.photos.length}, ${member.sortOrder}, 1) ` +
          `ON CONFLICT(id) DO UPDATE SET pool_id=excluded.pool_id, group_id=excluded.group_id, name=excluded.name, name_lower=excluded.name_lower, full_name=excluded.full_name, photo_total=excluded.photo_total, enabled=1;`,
      );
    }
  }
  const liveCardIds = new Set<string>();
  for (const { file, manifest } of loaded.groups) {
    for (const member of manifest.members) {
      for (const photo of member.photos) {
        const cardId = cardIdFor(member.id, photo.photoNo);
        if (!photo.enabled) continue;
        liveCardIds.add(cardId);
        const serial = lock.cards[cardId];
        if (serial === undefined) {
          throw new Error(`${file}: card ${cardId} has no serial assigned`);
        }
        const imageFile = builtFiles.get(cardId);
        if (imageFile === undefined) continue; // raw missing: keep old row, skip update
        lines.push(
          `INSERT INTO cards (id, pool_id, group_id, member_id, serial, photo_no, rarity, image_file, source_page_url, enabled) VALUES (${sqlText(cardId)}, ${sqlText(manifest.pool)}, ${sqlText(manifest.group.id)}, ${sqlText(member.id)}, ${serial}, ${photo.photoNo}, ${sqlText(photo.rarity)}, ${sqlText(imageFile)}, ${sqlNullableText(photo.sourcePageUrl)}, 1) ` +
            `ON CONFLICT(id) DO UPDATE SET pool_id=excluded.pool_id, group_id=excluded.group_id, member_id=excluded.member_id, serial=excluded.serial, photo_no=excluded.photo_no, rarity=excluded.rarity, image_file=excluded.image_file, source_page_url=excluded.source_page_url, enabled=1;`,
        );
      }
    }
  }
  // Groups/members gone from the manifest (takedown): disable, never delete.
  // Cards are disabled separately below; orphaned groups stay hidden from
  // the catalog and koleksi scopes.
  const liveGroupIds = new Set<string>();
  const liveMemberIds = new Set<string>();
  for (const { manifest } of loaded.groups) {
    liveGroupIds.add(manifest.group.id);
    for (const member of manifest.members) liveMemberIds.add(member.id);
  }
  if (liveGroupIds.size > 0) {
    const list = [...liveGroupIds].map(sqlText).join(",");
    lines.push(`UPDATE groups SET enabled=0 WHERE id NOT IN (${list});`);
  } else {
    lines.push(`UPDATE groups SET enabled=0;`);
  }
  if (liveMemberIds.size > 0) {
    const list = [...liveMemberIds].map(sqlText).join(",");
    lines.push(`UPDATE members SET enabled=0 WHERE id NOT IN (${list});`);
  } else {
    lines.push(`UPDATE members SET enabled=0;`);
  }
  // Cards gone from the manifest (takedown): disable, never delete.
  if (liveCardIds.size > 0) {
    const list = [...liveCardIds].map(sqlText).join(",");
    lines.push(
      `UPDATE cards SET enabled=0 WHERE id NOT IN (${list});`,
    );
  } else {
    lines.push(`UPDATE cards SET enabled=0;`);
  }
  for (const [poolId, count] of poolMemberCount) {
    lines.push(
      `UPDATE pools SET member_count=${count} WHERE id=${sqlText(poolId)};`,
    );
  }
  lines.push("PRAGMA foreign_keys=ON;");
  return lines.join("\n") + "\n";
}

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

async function runD1Execute(args: string[]): Promise<void> {
  const { exec } = await import("node:child_process");
  const execAsync = promisify(exec);
  const quoted = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
  const wranglerBin = path.join(
    SCRIPTS_DIR,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  await execAsync(`"${wranglerBin}" d1 execute ${quoted}`, {
    cwd: path.join(SCRIPTS_DIR, ".."),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Resolve D1 target: argv flags win, env vars kept for POSIX compat. */
export function resolveSeedTarget(
  argv: readonly string[] = process.argv.slice(2),
): { remote: boolean; env: string | null } {
  const remote = argv.includes("--remote");
  const envFlag = argv.indexOf("--env");
  const envName =
    envFlag >= 0 && envFlag + 1 < argv.length
      ? (argv[envFlag + 1] as string)
      : null;
  if (remote || envName !== null) return { remote, env: envName };
  return {
    remote: process.env.SEED_TARGET === "remote",
    env: process.env.SEED_ENV ?? null,
  };
}

async function main(): Promise<void> {
  const root = resolveManifestRoot();
  const loaded = await loadAndReport(root);

  // Serials: load previous lock (absent on first run), assign new.
  const lockPath = path.join(root, "data", "serials.lock.json");
  const prev: SerialsLock = (await tryReadSerialsLock(root)) ?? { ...EMPTY_LOCK };
  const cardPoolIds = new Map<string, string>();
  for (const { manifest } of loaded.groups) {
    for (const member of manifest.members) {
      for (const photo of member.photos) {
        if (!photo.enabled) continue;
        cardPoolIds.set(cardIdFor(member.id, photo.photoNo), manifest.pool);
      }
    }
  }
  const lock = assignSerials(loaded.pools, cardPoolIds, prev);
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");

  // Build frames for live cards with assigned serials + raw present.
  registerFonts(path.join(SCRIPTS_DIR, "fonts"));
  const { inputs, skipped } = await collectCardInputs(root, lock);
  for (const skip of skipped) {
    console.warn(`warning: skipping ${skip.cardId}: ${skip.reason}`);
  }
  const built = await buildAllCards(inputs, path.join(root, "public", "cards"));
  console.log(`built ${built.length} card(s), skipped ${skipped.length}`);
  const builtFiles = new Map(built.map((b) => [b.cardId, b.fileName]));

  // Temp SQL outside the repo (content-hashed names are only valid now).
  const sql = renderSeedSql(loaded, builtFiles, lock);
  const tmpDir = await mkdtemp(path.join(tmpdir(), "gatchawek-seed-"));
  const tmpFile = path.join(tmpDir, "seed.sql");
  await writeFile(tmpFile, sql, "utf8");
  try {
    const target = resolveSeedTarget();
    if (target.env !== null) {
      console.log(`applying seed to ${target.env} D1...`);
      await runD1Execute(["DB", "--env", target.env, "--remote", "--file", tmpFile]);
    } else if (target.remote) {
      console.log("applying seed to remote D1...");
      await runD1Execute(["DB", "--remote", "--file", tmpFile]);
    } else {
      await runD1Execute(["DB", "--local", "--file", tmpFile]);
    }
    console.log(
      `seeded ${loaded.pools.length} pool(s), ${loaded.groups.length} group(s), ${cardPoolIds.size} card(s)`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function loadAndReport(root: string) {
  let loaded;
  try {
    loaded = await loadManifests(root);
  } catch (err: unknown) {
    if (err instanceof ManifestError) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  for (const line of summarize(loaded)) {
    console.log(line);
  }
  for (const warning of rarityWarnings(loaded)) {
    console.warn(warning);
  }
  return loaded;
}

const invokedAsMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsMain) {
  try {
    await main();
  } catch (err: unknown) {
    if (err instanceof ManifestError) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  }
}
