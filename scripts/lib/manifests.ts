import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { z } from "zod";
import {
  groupManifestSchema,
  poolSchema,
  RARITY_KEYS,
  type GroupManifest,
  type PoolManifest,
} from "../../shared/manifest.schema.js";

export interface LoadedGroup {
  file: string;
  manifest: GroupManifest;
}

export interface LoadedManifests {
  pools: PoolManifest[];
  poolIds: Set<string>;
  groups: LoadedGroup[];
}

export class ManifestError extends Error {}

function formatZod(issue: z.core.$ZodIssue): string {
  const at = issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
  return `${issue.message}${at}`;
}

/** Repo root by default; tests override via MANIFEST_ROOT. */
export function resolveManifestRoot(): string {
  const override = process.env.MANIFEST_ROOT;
  if (override !== undefined && override !== "") return override;
  return fileURLToPath(new URL("../..", import.meta.url));
}

export async function loadManifests(root?: string): Promise<LoadedManifests> {
  const base = root ?? resolveManifestRoot();

  const poolsRaw = JSON.parse(
    await readFile(path.join(base, "data", "pools.json"), "utf8").catch(
      (err: unknown) => {
        throw new ManifestError(
          `data/pools.json: cannot read file: ${(err as Error).message}`,
        );
      },
    ),
  ) as unknown;
  const poolsParsed = z.array(poolSchema).safeParse(poolsRaw);
  if (!poolsParsed.success) {
    const first = poolsParsed.error.issues[0];
    throw new ManifestError(
      `data/pools.json: ${(first !== undefined ? formatZod(first) : "invalid")}`,
    );
  }
  const pools = poolsParsed.data;
  const poolIds = new Set<string>();
  for (const pool of pools) {
    if (poolIds.has(pool.id)) {
      throw new ManifestError(
        `data/pools.json: duplicate pool id "${pool.id}"`,
      );
    }
    poolIds.add(pool.id);
  }

  const groupsDir = path.join(base, "data", "groups");
  let poolDirs: string[];
  try {
    poolDirs = await readdir(groupsDir);
  } catch (err: unknown) {
    throw new ManifestError(
      `data/groups: cannot read directory: ${(err as Error).message}`,
    );
  }
  const groups: LoadedGroup[] = [];
  for (const poolDir of poolDirs.sort()) {
    const dir = path.join(groupsDir, poolDir);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
      const rel = path.join("data", "groups", poolDir, file);
      const raw = JSON.parse(
        await readFile(path.join(base, rel), "utf8").catch((err: unknown) => {
          throw new ManifestError(
            `${rel}: cannot read file: ${(err as Error).message}`,
          );
        }),
      ) as unknown;
      const parsed = groupManifestSchema.safeParse(raw);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new ManifestError(
          `${rel}: ${(first !== undefined ? formatZod(first) : "invalid group manifest")}`,
        );
      }
      groups.push({ file: rel, manifest: parsed.data });
    }
  }

  const memberFiles = new Map<string, string>();
  for (const { file, manifest } of groups) {
    if (!poolIds.has(manifest.pool)) {
      throw new ManifestError(
        `${file}: pool "${manifest.pool}" not found in data/pools.json`,
      );
    }
    for (const member of manifest.members) {
      const prev = memberFiles.get(member.id);
      if (prev !== undefined) {
        throw new ManifestError(
          `${file}: duplicate member id "${member.id}" (also in ${prev})`,
        );
      }
      memberFiles.set(member.id, file);
      const nos = member.photos.map((p) => p.photoNo).sort((a, b) => a - b);
      for (let i = 0; i < nos.length; i++) {
        if (nos[i] !== i + 1) {
          throw new ManifestError(
            `${file}: member "${member.id}" photoNo must be 1..N without gaps (found ${nos.join(",")})`,
          );
        }
      }
    }
  }

  return { pools, poolIds, groups };
}

const EXPECTED_DIST = { common: 50, rare: 28, super_rare: 9, ultra_rare: 5 };

/** Rarity mixes far from 50/30/15/5 are warnings, never errors. */
export function rarityWarnings(loaded: LoadedManifests): string[] {
  const warnings: string[] = [];
  for (const { file, manifest } of loaded.groups) {
    const counts: Record<string, number> = {
      common: 0,
      rare: 0,
      super_rare: 0,
      ultra_rare: 0,
    };
    let total = 0;
    for (const member of manifest.members) {
      for (const photo of member.photos) {
        counts[photo.rarity] = (counts[photo.rarity] ?? 0) + 1;
        total++;
      }
    }
    if (total === 0) continue;
    const dist = RARITY_KEYS.map(
      (k) => `${k} ${(((counts[k] ?? 0) / total) * 100).toFixed(1)}%`,
    ).join("/");
    const far = RARITY_KEYS.some(
      (k) =>
        Math.abs(((counts[k] ?? 0) / total) * 100 - EXPECTED_DIST[k]) > 10,
    );
    if (far) {
      warnings.push(
        `warning: ${file} rarity distribution far from 50/30/15/5 (${dist})`,
      );
    }
  }
  return warnings;
}

/** Members with fewer than 3 photos are warnings, never errors: community
 * inject accepts a single photo per message, top-ups arrive over time. */
export function photoWarnings(loaded: LoadedManifests): string[] {
  const warnings: string[] = [];
  for (const { file, manifest } of loaded.groups) {
    for (const member of manifest.members) {
      if (member.photos.length < 3) {
        warnings.push(
          `warning: ${file} member "${member.id}" has ${String(member.photos.length)} photo(s), ideally at least 3`,
        );
      }
    }
  }
  return warnings;
}

export function summarize(loaded: LoadedManifests): string[] {
  return loaded.groups.map(({ manifest }) => {
    const counts: Record<string, number> = {
      common: 0,
      rare: 0,
      super_rare: 0,
      ultra_rare: 0,
    };
    let photos = 0;
    for (const member of manifest.members) {
      for (const photo of member.photos) {
        counts[photo.rarity] = (counts[photo.rarity] ?? 0) + 1;
        photos++;
      }
    }
    return (
      `${manifest.pool}/${manifest.group.id}: ${manifest.members.length} member, ` +
      `${photos} foto, [${counts["common"]}/${counts["rare"]}/${counts["super_rare"]}/${counts["ultra_rare"]}]`
    );
  });
}
