import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  loadManifests,
  ManifestError,
  resolveManifestRoot,
} from "./lib/manifests.js";

export interface FetchFailure {
  cardId: string;
  imageUrl: string;
  reason: string;
}

const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;
const MIN_WIDTH = 500;
const MIN_HEIGHT = 700;
const USER_AGENT = "gatchawek-bot/1.0 (private-server)";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const COLOR_RE = /^color:(#[0-9a-fA-F]{6})$/;

function cardIdFor(memberId: string, photoNo: number): string {
  return `${memberId}-${String(photoNo).padStart(2, "0")}`;
}

function parseColor(imageUrl: string): string | null {
  const match = COLOR_RE.exec(imageUrl);
  return match?.[1] ?? null;
}

async function writeSolidPng(
  hex: string,
  outPath: string,
): Promise<void> {
  const canvas = createCanvas(MIN_WIDTH, MIN_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, MIN_WIDTH, MIN_HEIGHT);
  const png = await canvas.encode("png");
  await writeFile(outPath, png);
}

async function fetchRemoteImage(
  cardId: string,
  imageUrl: string,
  rawDir: string,
): Promise<string | FetchFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      return { cardId, imageUrl, reason: `http ${res.status}` };
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      return {
        cardId,
        imageUrl,
        reason: `unexpected content-type "${contentType}"`,
      };
    }
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (ext === undefined) {
      return {
        cardId,
        imageUrl,
        reason: `unsupported image content-type "${contentType}"`,
      };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let decoded;
    try {
      decoded = await loadImage(bytes);
    } catch (err: unknown) {
      return {
        cardId,
        imageUrl,
        reason: `decode failed: ${(err as Error).message}`,
      };
    }
    if (decoded.width < MIN_WIDTH || decoded.height < MIN_HEIGHT) {
      return {
        cardId,
        imageUrl,
        reason: `too small: ${decoded.width}x${decoded.height} < ${MIN_WIDTH}x${MIN_HEIGHT}`,
      };
    }
    const outPath = path.join(rawDir, `${cardId}.${ext}`);
    await writeFile(outPath, bytes);
    return outPath;
  } catch (err: unknown) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timeout after 30s"
        : (err as Error).message;
    return { cardId, imageUrl, reason };
  } finally {
    clearTimeout(timer);
  }
}

interface Job {
  cardId: string;
  imageUrl: string;
}

async function runPool(
  jobs: Job[],
  rawDir: string,
  failed: FetchFailure[],
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next] as Job | undefined;
      next++;
      if (job === undefined) return;
      const color = parseColor(job.imageUrl);
      if (color !== null) {
        await writeSolidPng(color, path.join(rawDir, `${job.cardId}.png`));
        continue;
      }
      const result = await fetchRemoteImage(job.cardId, job.imageUrl, rawDir);
      if (typeof result !== "string") failed.push(result);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()),
  );
}

export async function fetchAllImages(
  root?: string,
): Promise<{ downloaded: number; failed: FetchFailure[] }> {
  const base = root ?? resolveManifestRoot();
  const loaded = await loadManifests(base);
  const rawDir = path.join(base, "assets", "raw");
  await mkdir(rawDir, { recursive: true });

  const jobs: Job[] = [];
  for (const { manifest } of loaded.groups) {
    for (const member of manifest.members) {
      for (const photo of member.photos) {
        if (!photo.enabled) continue;
        jobs.push({
          cardId: cardIdFor(member.id, photo.photoNo),
          imageUrl: photo.imageUrl,
        });
      }
    }
  }

  const failed: FetchFailure[] = [];
  await runPool(jobs, rawDir, failed);

  const reportDir = path.join(base, "data", "reports");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    path.join(reportDir, "fetch-report.json"),
    JSON.stringify({ failed }, null, 2),
    "utf8",
  );
  return { downloaded: jobs.length - failed.length, failed: failed };
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const { downloaded, failed } = await fetchAllImages();
    console.log(`fetched ${downloaded} image(s), ${failed.length} failed`);
  } catch (err: unknown) {
    if (err instanceof ManifestError) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
