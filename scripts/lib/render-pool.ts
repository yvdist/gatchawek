import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { buildCardImage, type CardInput } from "./build-cards.js";
import { fetchRemoteImage, type FetchFailure } from "../fetch-images.js";

const execFileAsync = promisify(execFile);

export interface RenderCard {
  id: string;
  badge: string;
  memberName: string;
  photoLabel: string | null;
  fullName: string | null;
  rarity: string;
  serial: number;
  photoNo: number;
  photoTotal: number;
  imageUrl: string;
}

export interface RenderUpdate {
  cardId: string;
  fileName: string;
}

export interface RenderPoolHooks {
  /** dir for raw downloads; defaults to <root>/assets/raw. */
  rawDir: string;
  /** upload a finished webp buffer, returns the R2 object name. */
  upload: (cardId: string, buffer: Buffer) => Promise<string>;
  /** persist one batch of filename updates; defaults to D1 update file. */
  flushUpdates: (updates: RenderUpdate[]) => Promise<void>;
  fetchImage?: (
    cardId: string,
    imageUrl: string,
    rawDir: string,
  ) => Promise<string | FetchFailure>;
  buildImage?: (input: CardInput) => Promise<Buffer>;
  onBuilt?: (cardId: string, fileName: string) => void;
  onSkipped?: (cardId: string, reason: string) => void;
}

export interface RenderPoolOptions {
  jobs?: number;
  gapMs?: number;
  cooldownMs?: number;
  flushEvery?: number;
  max429?: number;
}

export interface RenderPoolResult {
  updated: number;
  failed: string[];
  stopped429: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Render cards in parallel worker lanes sharing one 429 budget.
 *
 * Throughput is Discord-CDN-bound (~10s/card measured), not CPU-bound:
 * lanes overlap fetch → canvas → R2 upload instead of waiting serially.
 * Any lane hitting 429 bumps a shared counter; past max429 every lane
 * stops scheduling new downloads (global cooldown instead of per-lane
 * 60s retries that would multiply the ban). Updates flush per batch so
 * a killed run keeps everything flushed so far (no orphan R2 objects).
 */
export async function renderPool(
  cards: RenderCard[],
  hooks: RenderPoolHooks,
  opts: RenderPoolOptions = {},
): Promise<RenderPoolResult> {
  const jobs = Math.max(1, Math.min(opts.jobs ?? 4, Math.max(1, cards.length)));
  const gapMs = opts.gapMs ?? 2000;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const flushEvery = Math.max(1, opts.flushEvery ?? 25);
  const max429 = Math.max(1, opts.max429 ?? 3);

  const fetchImage = hooks.fetchImage ?? fetchRemoteImage;
  const buildImage = hooks.buildImage ?? buildCardImage;

  let next = 0;
  let rateLimited = 0;
  let coolingUntil = 0;
  let stopped429 = false;
  const updates: RenderUpdate[] = [];
  const failed: string[] = [];

  async function waitForCooldown(): Promise<boolean> {
    const waitMs = coolingUntil - Date.now();
    if (waitMs > 0) await delay(waitMs);
    return stopped429;
  }

  async function note429(cardId: string): Promise<void> {
    rateLimited += 1;
    if (rateLimited >= max429) {
      stopped429 = true;
      failed.push(`${cardId}: http 429 (breaker tripped, run stopped)`);
      return;
    }
    coolingUntil = Date.now() + cooldownMs;
    failed.push(`${cardId}: http 429 (cooldown ${String(cooldownMs / 1000)}s)`);
    await waitForCooldown();
  }

  async function renderOne(card: RenderCard): Promise<RenderUpdate | null> {
    const fetched = await fetchImage(card.id, card.imageUrl, hooks.rawDir);
    if (typeof fetched !== "string") {
      if (fetched.reason.includes("429")) await note429(card.id);
      else failed.push(`${card.id}: ${fetched.reason}`);
      hooks.onSkipped?.(card.id, fetched.reason);
      return null;
    }
    const buffer = await buildImage({
      cardId: card.id,
      badge: card.badge,
      memberName: card.memberName,
      photoLabel: card.photoLabel,
      fullName: card.fullName,
      rarity: card.rarity,
      serial: card.serial,
      photoNo: card.photoNo,
      photoTotal: card.photoTotal,
      rawPath: fetched,
      focusX: 0.5,
      focusY: 0.35,
    });
    const fileName = await hooks.upload(card.id, buffer);
    hooks.onBuilt?.(card.id, fileName);
    return { cardId: card.id, fileName };
  }

  async function lane(laneIndex: number): Promise<void> {
    if (laneIndex > 0 && gapMs > 0) await delay(gapMs * laneIndex);
    for (;;) {
      if (stopped429) return;
      if (await waitForCooldown()) return;
      const index = next;
      next += 1;
      const card = cards[index];
      if (card === undefined) return;
      if (laneIndex > 0 && gapMs > 0) await delay(gapMs);
      if (stopped429) {
        next -= 1;
        return;
      }
      const update = await renderOne(card);
      if (update !== null) updates.push(update);
    }
  }

  await Promise.all(Array.from({ length: jobs }, (_, i) => lane(i)));

  let updated = 0;
  for (const batch of chunk(updates, flushEvery)) {
    await hooks.flushUpdates(batch);
    updated += batch.length;
  }
  return { updated, failed, stopped429 };
}

export function renderFileName(
  cardId: string,
  buffer: Buffer,
  ext: "webp" | "gif" = "webp",
): string {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  return `${cardId}.${hash}.${ext}`;
}

export interface WranglerRunner {
  cmd: string;
  preArgs: string[];
}

/** Upload via wrangler R2 object put (binary-safe temp file pattern). */
export async function wranglerR2Upload(
  root: string,
  wrangler: WranglerRunner,
  bucket: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "gatchawek-r2-"));
  const contentType = fileName.endsWith(".gif") ? "image/gif" : "image/webp";
  try {
    const tmpFile = path.join(dir, fileName);
    await writeFile(tmpFile, buffer);
    await execFileAsync(
      wrangler.cmd,
      [...wrangler.preArgs, "r2", "object", "put", `${bucket}/${fileName}`, "--file", tmpFile, "--content-type", contentType, "--remote"],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
