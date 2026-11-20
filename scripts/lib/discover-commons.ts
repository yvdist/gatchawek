import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { RarityKey } from "../../shared/manifest.schema.js";

/**
 * Pure helpers + cached MediaWiki fetchers for the discover-commons pipeline.
 * No filesystem access except the cache dir passed into fetchJsonCached.
 * No imports from db/ or discord/ (layer rule).
 */

export const USER_AGENT =
  "gatchawek-bot/1.0 (private Discord photocard bot; discover-commons; contact: repo admin)";
export const GAP_MS = 200;
export const TIMEOUT_MS = 30_000;
export const MAXLAG = 5;
export const MAXLAG_RETRIES = 3;
export const MAXLAG_RETRY_SLEEP_MS = 5_000;
export const RATE_LIMIT_RETRIES = 5;
export const CACHE_DIR = "assets/raw/api-cache";
export const MIN_SHORT_SIDE = 700;
export const GCM_LIMIT = 50;
export const PORTRAIT_BONUS = 1_000_000_000;
export const MAX_FILES_PER_MEMBER = 500;
export const MAX_PHOTOS_PER_MEMBER = 6;
export const MIN_PHOTOS_PER_MEMBER = 3;

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiErrorCode(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const err: unknown = (data as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return null;
  const code: unknown = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function fetchJsonCached(
  url: string,
  cacheDir: string,
): Promise<unknown> {
  const u = new URL(url);
  const key = createHash("sha1").update(url).digest("hex");
  const dir = path.join(cacheDir, u.hostname);
  const file = path.join(dir, `${key}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    // Cache miss: fall through to network.
  }
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: unknown) {
      throw new Error(
        `fetch ${u.hostname}${u.pathname}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    await sleep(GAP_MS);
    if (res.status === 429) {
      if (attempt >= RATE_LIMIT_RETRIES) {
        throw new Error(`fetch ${u.hostname}${u.pathname}: 429`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : MAXLAG_RETRY_SLEEP_MS * (attempt + 1),
      );
      continue;
    }
    if (!res.ok) {
      throw new Error(`fetch ${u.hostname}${u.pathname}: ${res.status}`);
    }
    let data: unknown;
    try {
      data = (await res.json()) as unknown;
    } catch {
      throw new Error(`fetch ${u.hostname}${u.pathname}: bad-json`);
    }
    if (apiErrorCode(data) === "maxlag") {
      if (attempt >= MAXLAG_RETRIES) {
        throw new Error(`maxlag retries exhausted: ${u.hostname}${u.pathname}`);
      }
      await sleep(MAXLAG_RETRY_SLEEP_MS);
      continue;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(data), "utf8");
    return data;
  }
}

export function wikipediaPagePropsUrl(lang: string, title: string): string {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "pageprops",
    format: "json",
    formatversion: "2",
  });
  return `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
}

export function wikidataClaimsUrl(qid: string): string {
  const params = new URLSearchParams({
    action: "wbgetclaims",
    entity: qid,
    property: "P373",
    format: "json",
    formatversion: "2",
  });
  return `https://www.wikidata.org/w/api.php?${params.toString()}`;
}

export function commonsCategoryUrl(
  category: string,
  cont: string | null,
): string {
  const params = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle: `Category:${category}`,
    gcmtype: "file",
    gcmlimit: String(GCM_LIMIT),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1200",
    iiextmetadatafilter: "LicenseShortName|Artist",
    format: "json",
    formatversion: "2",
    maxlag: String(MAXLAG),
  });
  if (cont !== null) params.set("gcmcontinue", cont);
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
}

/** Lowercase slug ≤30 chars; empty becomes "member"; collisions get -2, -3… */
export function slugifyMemberId(
  fullName: string,
  taken: Set<string>,
): string {
  let slug = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > 30) slug = slug.slice(0, 30).replace(/-+$/g, "");
  if (slug === "") slug = "member";
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  const suffixed = `${slug}-${n}`;
  taken.add(suffixed);
  return suffixed;
}

/** Strip Commons Artist HTML to plain text; empty/missing becomes null. */
export function stripArtistHtml(html: string): string | null {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text;
}

/**
 * Fail-closed license gate. Returns the trimmed short name when the file is
 * safe to use, null when it must be skipped (unknown, empty, or non-free
 * like Copyrighted / Fair use / GFDL-only).
 */
export function licenseAllowed(
  shortName: string | null | undefined,
): string | null {
  if (shortName === null || shortName === undefined) return null;
  const trimmed = shortName.trim();
  if (trimmed === "") return null;
  if (/^(cc0|public domain|pd(\s|-|$))/i.test(trimmed)) return trimmed;
  if (/^cc\s?by\s?-\s?sa(\s|$)/i.test(trimmed)) return trimmed;
  if (/^cc\s?by(\s|-|$)/i.test(trimmed)) return trimmed;
  return null;
}

/** Portrait always outranks landscape (2:3 frame); area breaks ties. */
export function scorePhoto(width: number, height: number): number {
  return (height > width ? PORTRAIT_BONUS : 0) + width * height;
}

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Rank-1 photo is ultra_rare for ~1/4 of members (fnv1a32(memberId) % 4),
 * else super_rare. Rank 2 is rare; rank 3 is rare when n >= 5 else common;
 * rank 4+ is common. Pure and deterministic.
 */
export function assignRarities<T>(
  memberId: string,
  photos: readonly T[],
): Array<T & { rarity: RarityKey }> {
  const ultra = fnv1a32(memberId) % 4 === 0;
  return photos.map((photo, index) => {
    const rank = index + 1;
    let rarity: RarityKey;
    if (rank === 1) {
      rarity = ultra ? "ultra_rare" : "super_rare";
    } else if (rank === 2) {
      rarity = "rare";
    } else if (rank === 3) {
      rarity = photos.length >= 5 ? "rare" : "common";
    } else {
      rarity = "common";
    }
    return { ...photo, rarity };
  });
}

const wikipediaResponseSchema = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          pageid: z.number().optional(),
          missing: z.unknown().optional(),
          invalid: z.unknown().optional(),
          title: z.string(),
          pageprops: z
            .object({
              wikibase_item: z.string().optional(),
              disambiguation: z.unknown().optional(),
            })
            .optional(),
        }),
      ),
    })
    .optional(),
});

/** Throws wikipedia-missing / wikipedia-disambiguation / wikipedia-no-wikibase-item. */
export function extractWikibaseItem(data: unknown): string {
  const parsed = wikipediaResponseSchema.safeParse(data);
  if (!parsed.success || parsed.data.query?.pages === undefined) {
    throw new Error("api-shape-changed:wikipedia.query.pages");
  }
  const page = parsed.data.query.pages[0];
  if (page === undefined || page.missing !== undefined || page.invalid !== undefined || page.pageid === undefined) {
    throw new Error("wikipedia-missing");
  }
  if (page.pageprops?.disambiguation !== undefined) {
    throw new Error("wikipedia-disambiguation");
  }
  const qid = page.pageprops?.wikibase_item;
  if (qid === undefined || qid === "") {
    throw new Error("wikipedia-no-wikibase-item");
  }
  return qid;
}

const wikidataClaimSchema = z.object({
  rank: z.string().optional(),
  mainsnak: z
    .object({
      datavalue: z.object({ value: z.unknown() }).optional(),
    })
    .optional(),
});

const wikidataResponseSchema = z.object({
  claims: z.record(z.string(), z.array(wikidataClaimSchema)),
});

function claimStringValue(
  claim: z.infer<typeof wikidataClaimSchema>,
): string | null {
  const value: unknown = claim.mainsnak?.datavalue?.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/** Commons category from P373 (preferred > normal, deprecated ignored). */
export function extractCommonsCategory(data: unknown): string {
  const parsed = wikidataResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("api-shape-changed:wikidata.claims");
  }
  const claims = parsed.data.claims["P373"];
  if (claims === undefined || claims.length === 0) {
    throw new Error("wikidata-no-P373");
  }
  const preferred = claims.find((c) => c.rank === "preferred");
  if (preferred !== undefined) {
    const value = claimStringValue(preferred);
    if (value !== null) return value;
  }
  const normal = claims.find(
    (c) => c.rank === "normal" || c.rank === undefined,
  );
  if (normal !== undefined) {
    const value = claimStringValue(normal);
    if (value !== null) return value;
  }
  throw new Error("wikidata-no-P373");
}

const commonsInfoSchema = z.object({
  url: z.string().optional(),
  thumburl: z.string().optional(),
  descriptionurl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  mime: z.string().optional(),
  extmetadata: z
    .object({
      LicenseShortName: z.object({ value: z.unknown() }).optional(),
      Artist: z.object({ value: z.unknown() }).optional(),
    })
    .optional(),
});

const commonsPageSchema = z.object({
  title: z.string(),
  imageinfo: z.array(commonsInfoSchema).optional(),
});

const commonsResponseSchema = z.object({
  continue: z.object({ gcmcontinue: z.string().optional() }).optional(),
  query: z
    .object({
      pages: z
        .union([
          z.array(commonsPageSchema),
          z.record(z.string(), commonsPageSchema),
        ])
        .optional(),
    })
    .optional(),
});

export interface CommonsFileCandidate {
  title: string;
  url: string | null;
  thumburl: string | null;
  descriptionurl: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  licenseShortName: string | null;
  artistHtml: string | null;
}

export interface CommonsPage {
  files: CommonsFileCandidate[];
  next: string | null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function parseCommonsResponse(data: unknown): CommonsPage {
  const parsed = commonsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("api-shape-changed:commons");
  }
  const raw = parsed.data.query?.pages;
  const list =
    raw === undefined
      ? []
      : Array.isArray(raw)
        ? raw
        : Object.values(raw);
  const files: CommonsFileCandidate[] = list.map((page) => {
    const info = page.imageinfo?.[0];
    return {
      title: page.title,
      url: info?.url ?? null,
      thumburl: info?.thumburl ?? null,
      descriptionurl: info?.descriptionurl ?? null,
      width: numOrNull(info?.width),
      height: numOrNull(info?.height),
      mime: info?.mime ?? null,
      licenseShortName: strOrNull(info?.extmetadata?.LicenseShortName?.value),
      artistHtml: strOrNull(info?.extmetadata?.Artist?.value),
    };
  });
  return {
    files,
    next: parsed.data.continue?.gcmcontinue ?? null,
  };
}

export interface EligiblePhoto {
  title: string;
  imageUrl: string;
  sourcePageUrl: string;
  license: string;
  author: string | null;
  width: number;
  height: number;
}

export interface SkippedFile {
  title: string;
  reason: string;
}

/** Split category files into usable photos vs per-file skip notes. */
export function selectEligible(files: CommonsFileCandidate[]): {
  eligible: EligiblePhoto[];
  skipped: SkippedFile[];
} {
  const eligible: EligiblePhoto[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    if (file.mime === null || !ALLOWED_MIMES.has(file.mime)) {
      skipped.push({ title: file.title, reason: `mime-not-allowed:${file.mime ?? "unknown"}` });
      continue;
    }
    if (file.width === null || file.height === null) {
      skipped.push({ title: file.title, reason: "no-dimensions" });
      continue;
    }
    if (Math.min(file.width, file.height) < MIN_SHORT_SIDE) {
      skipped.push({ title: file.title, reason: "too-small" });
      continue;
    }
    const license = licenseAllowed(file.licenseShortName);
    if (license === null) {
      skipped.push({ title: file.title, reason: "license-not-allowed" });
      continue;
    }
    const imageUrl = file.thumburl ?? file.url;
    if (imageUrl === null) {
      skipped.push({ title: file.title, reason: "no-image-url" });
      continue;
    }
    if (file.descriptionurl === null) {
      skipped.push({ title: file.title, reason: "no-source-url" });
      continue;
    }
    eligible.push({
      title: file.title,
      imageUrl,
      sourcePageUrl: file.descriptionurl,
      license,
      author: file.artistHtml === null ? null : stripArtistHtml(file.artistHtml),
      width: file.width,
      height: file.height,
    });
  }
  return { eligible, skipped };
}

/** Score desc, descriptionurl asc tiebreak. Returns a new array. */
export function rankPhotos(photos: EligiblePhoto[]): EligiblePhoto[] {
  return [...photos].sort((a, b) => {
    const byScore = scorePhoto(b.width, b.height) - scorePhoto(a.width, a.height);
    if (byScore !== 0) return byScore;
    if (a.sourcePageUrl < b.sourcePageUrl) return -1;
    if (a.sourcePageUrl > b.sourcePageUrl) return 1;
    return 0;
  });
}

/** Minimal HTML escaping for the contact-sheet report. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
