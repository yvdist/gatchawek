import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  loadManifests,
  resolveManifestRoot,
  type LoadedManifests,
} from "./manifests.js";
import type { CardInput } from "./build-cards.js";

export interface SerialsLock {
  cards: Record<string, number>;
  pools: Record<string, number>;
}

export const EMPTY_LOCK: SerialsLock = { cards: {}, pools: {} };

export function cardIdFor(memberId: string, photoNo: number): string {
  return `${memberId}-${String(photoNo).padStart(2, "0")}`;
}

export async function readSerialsLock(root: string): Promise<SerialsLock> {
  const lockPath = path.join(root, "data", "serials.lock.json");
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error("data/serials.lock.json not found — run pnpm seed first", {
        cause: err,
      });
    }
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("data/serials.lock.json has unexpected shape");
  }
  const cards: unknown =
    "cards" in parsed ? parsed.cards : undefined;
  const pools: unknown =
    "pools" in parsed ? parsed.pools : undefined;
  if (!isNumberRecord(cards) || !isNumberRecord(pools)) {
    throw new Error("data/serials.lock.json has unexpected shape");
  }
  return { cards, pools };
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => typeof v === "number");
}

/** Null when the lock file does not exist yet (first seed run). */
export async function tryReadSerialsLock(
  root: string,
): Promise<SerialsLock | null> {
  try {
    return await readSerialsLock(root);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes("not found — run pnpm seed first")
    ) {
      return null;
    }
    throw err;
  }
}

/** Cards present in manifests but missing a raw download (link rusak). */
export interface SkippedCard {
  cardId: string;
  reason: string;
}

const RAW_EXTS = ["png", "jpg", "webp", "gif", "avif"];

async function resolveRawPath(
  rawDir: string,
  cardId: string,
): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(rawDir);
  } catch {
    return null;
  }
  for (const ext of RAW_EXTS) {
    const name = `${cardId}.${ext}`;
    if (files.includes(name)) return path.join(rawDir, name);
  }
  return null;
}

export interface CardCollection {
  loaded: LoadedManifests;
  inputs: CardInput[];
  skipped: SkippedCard[];
  lock: SerialsLock;
  root: string;
}

/**
 * Manifests + serials lock → render inputs. Skips (never throws on) cards
 * whose raw image is missing; callers report them as warnings.
 */
export async function collectCardInputs(
  root?: string,
  lockOverride?: SerialsLock,
): Promise<CardCollection> {
  const base = root ?? resolveManifestRoot();
  const loaded = await loadManifests(base);
  const lock = lockOverride ?? (await readSerialsLock(base));
  const rawDir = path.join(base, "assets", "raw");
  const groupBadge = new Map<string, string>();
  for (const { manifest } of loaded.groups) {
    groupBadge.set(manifest.group.id, manifest.group.badge);
  }

  const inputs: CardInput[] = [];
  const skipped: SkippedCard[] = [];
  for (const { file, manifest } of loaded.groups) {
    for (const member of manifest.members) {
      for (const photo of member.photos) {
        if (!photo.enabled) continue;
        const cardId = cardIdFor(member.id, photo.photoNo);
        const serial = lock.cards[cardId];
        if (serial === undefined) {
          skipped.push({
            cardId,
            reason: `${file}: no serial assigned (run pnpm seed)`,
          });
          continue;
        }
        const rawPath = await resolveRawPath(rawDir, cardId);
        if (rawPath === null) {
          skipped.push({
            cardId,
            reason: `${file}: raw image missing in assets/raw/ (fetch failed?)`,
          });
          continue;
        }
        inputs.push({
          cardId,
          badge: groupBadge.get(manifest.group.id) ?? manifest.group.id,
          memberName: member.name,
          fullName: member.fullName ?? null,
          rarity: photo.rarity,
          serial,
          photoNo: photo.photoNo,
          photoTotal: member.photos.length,
          rawPath,
          focusX: photo.focus.x,
          focusY: photo.focus.y,
        });
      }
    }
  }
  return { loaded, inputs, skipped, lock, root: base };
}
