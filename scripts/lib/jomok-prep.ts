import { createHash } from "node:crypto";
import type { Image } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { RarityKey } from "../../shared/manifest.schema.js";

/** Fraction-of-H fallback when no divider pair is detected (survey: unused, 108/108 detected). */
export const DIVIDER_FALLBACK_PHOTO_END = 0.56;

export interface DividerResult {
  photoEnd: number;
  nameEnd: number;
  fallback: boolean;
}

/**
 * Find the two white horizontal divider lines in template card photos.
 * Scans rows in y ∈ [0.30H, 0.90H]; a row counts as divider when ≥90% of
 * pixels in x ∈ [0.02W, 0.98W] are white (r,g,b ≥ 200). Runs ≥3px tall
 * collapse to one line; the first two runs are the dividers.
 */
export function detectDividers(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
): DividerResult {
  const x0 = Math.floor(0.02 * w);
  const x1 = Math.ceil(0.98 * w);
  const span = x1 - x0;
  const yStart = Math.floor(0.3 * h);
  const yEnd = Math.ceil(0.9 * h);
  const runs: Array<[number, number]> = [];
  let runStart = -1;
  for (let y = yStart; y < yEnd; y++) {
    let white = 0;
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 4;
      const r = pixels[o] ?? 0;
      const g = pixels[o + 1] ?? 0;
      const b = pixels[o + 2] ?? 0;
      if (r >= 200 && g >= 200 && b >= 200) white++;
    }
    const isDivider = white / span >= 0.9;
    if (isDivider && runStart < 0) runStart = y;
    if (!isDivider && runStart >= 0) {
      if (y - runStart >= 3) runs.push([runStart, y]);
      runStart = -1;
    }
  }
  if (runStart >= 0 && yEnd - runStart >= 3) runs.push([runStart, yEnd]);
  if (runs.length < 2) {
    return {
      photoEnd: Math.round(DIVIDER_FALLBACK_PHOTO_END * h),
      nameEnd: Math.round((DIVIDER_FALLBACK_PHOTO_END + 0.12) * h),
      fallback: true,
    };
  }
  const first = runs[0];
  const second = runs[1];
  if (first === undefined || second === undefined) {
    return {
      photoEnd: Math.round(DIVIDER_FALLBACK_PHOTO_END * h),
      nameEnd: Math.round((DIVIDER_FALLBACK_PHOTO_END + 0.12) * h),
      fallback: true,
    };
  }
  return { photoEnd: first[0], nameEnd: second[0], fallback: false };
}

/** Crop the photo area above the first divider, insetting 10px to drop the white border. */
export function cropPhoto(img: Image, photoEnd: number): Buffer {
  const w = img.width;
  const h = photoEnd - 14;
  const canvas = createCanvas(w - 20, h - 10);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 10, 10, w - 20, h - 10, 0, 0, w - 20, h - 10);
  return canvas.toBuffer("image/jpeg", 90);
}

/**
 * Extract the name band for OCR: trims ~6px beside each divider (avoids white
 * strips confusing tesseract), crops horizontal margins (text is centered),
 * then binarizes AND inverts (tesseract needs dark text on light background)
 * to kill the gold diamond pattern, and upscales 2x.
 */
export function nameBand(img: Image, photoEnd: number, nameEnd: number): Buffer {
  const top = photoEnd + 6;
  const bottom = nameEnd - 6;
  const bandH = bottom - top;
  const marginX = Math.round(img.width * 0.05);
  const bandW = img.width - marginX * 2;
  const canvas = createCanvas(bandW, bandH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, marginX, top, bandW, bandH, 0, 0, bandW, bandH);
  const id = ctx.getImageData(0, 0, bandW, bandH);
  const px = id.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    const v = 0.299 * r + 0.587 * g + 0.114 * b >= 128 ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const out = createCanvas(bandW * 2, bandH * 2);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = false;
  octx.drawImage(canvas, 0, 0, bandW * 2, bandH * 2);
  return out.toBuffer("image/png");
}
/** Strip OCR edge junk (pipes, brackets, tildes from band ornaments); keep inner text. */
export function cleanOcrName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^a-zA-Z0-9(]+/, "")
    .replace(/[^a-zA-Z0-9)]+$/, "")
    .trim();
}

/** Lowercase, strip punctuation, spaces→hyphens, max 30 chars; empty → unknown-<index>. */
export function slugify(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return slug === "" ? `unknown-${index}` : slug;
}

/** Deterministic rarity by photo number: 1–2 common, 3–4 rare, 5 super_rare, 6+ ultra_rare. */
export function rarityFor(photoNo: number): RarityKey {
  if (photoNo <= 2) return "common";
  if (photoNo <= 4) return "rare";
  if (photoNo === 5) return "super_rare";
  return "ultra_rare";
}

export interface OcrRow {
  sourceFile: string;
  ocrName: string;
  confidence: number;
  hash: string;
  memberId: string;
  memberName: string;
  needsReview: boolean;
  reasons: string[];
}

/** sha256 hex of crop bytes (dedupe key). */
export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Group CSV rows by final member_id. Within a member, order by source_file
 * and assign sequential photoNo 1..N. Intra-member hash dupes are dropped
 * (filenames returned); a hash shared across members flags both rows
 * needsReview (cross-member dupe).
 */
export interface GroupedMember {
  memberId: string;
  memberName: string;
  rows: OcrRow[];
  dupes: string[];
}

export function groupRows(rows: OcrRow[]): Map<string, GroupedMember> {
  const hashOwners = new Map<string, Set<string>>();
  for (const row of rows) {
    let owners = hashOwners.get(row.hash);
    if (owners === undefined) {
      owners = new Set<string>();
      hashOwners.set(row.hash, owners);
    }
    owners.add(row.memberId);
  }
  const crossHashes = new Set<string>();
  for (const [hash, owners] of hashOwners) {
    if (owners.size > 1) crossHashes.add(hash);
  }

  const groups = new Map<string, GroupedMember>();
  for (const row of rows) {
    let g = groups.get(row.memberId);
    if (g === undefined) {
      g = { memberId: row.memberId, memberName: row.memberName, rows: [], dupes: [] };
      groups.set(row.memberId, g);
    }
    if (crossHashes.has(row.hash)) {
      row.needsReview = true;
      if (!row.reasons.includes("cross-member-dupe")) row.reasons.push("cross-member-dupe");
    }
    g.rows.push(row);
  }

  for (const g of groups.values()) {
    g.rows.sort((a, b) => (a.sourceFile < b.sourceFile ? -1 : a.sourceFile > b.sourceFile ? 1 : 0));
    const seen = new Set<string>();
    const kept: OcrRow[] = [];
    for (const row of g.rows) {
      if (seen.has(row.hash)) {
        g.dupes.push(row.sourceFile);
        continue;
      }
      seen.add(row.hash);
      kept.push(row);
    }
    g.rows = kept;
  }
  return groups;
}

/** Assign unique member_ids from OCR names: slugify + numeric suffix on collision. */
export function assignMemberIds(
  rows: Array<{ sourceFile: string; ocrName: string; confidence: number; hash: string }>,
): OcrRow[] {
  const used = new Map<string, string>();
  return rows.map((row, i) => {
    const cleanName = row.ocrName.trim().replace(/\s+/g, " ");
    const base = slugify(cleanName, i);
    let memberId = base;
    let n = 2;
    while (used.has(memberId) && used.get(memberId) !== cleanName) {
      memberId = `${base}-${n}`;
      n++;
    }
    if (used.has(memberId) && used.get(memberId) !== cleanName) {
      memberId = `${base}-${i}`;
    }
    used.set(memberId, cleanName);
    const reasons: string[] = [];
    if (row.confidence < 70 || cleanName === "") reasons.push("low-confidence");
    if (memberId !== base) reasons.push("slug-collision");
    return {
      sourceFile: row.sourceFile,
      ocrName: cleanName,
      confidence: row.confidence,
      hash: row.hash,
      memberId,
      memberName: cleanName,
      needsReview: reasons.length > 0,
      reasons,
    };
  });
}
