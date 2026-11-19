import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { createWorker, OEM, PSM } from "tesseract.js";
import { groupManifestSchema, type RarityKey } from "../shared/manifest.schema.js";
import {
  assignMemberIds,
  cleanOcrName,
  cropPhoto,
  detectDividers,
  groupRows,
  hashBytes,
  nameBand,
  rarityFor,
  type OcrRow,
} from "./lib/jomok-prep.js";
import { cardIdFor } from "./lib/card-inputs.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = process.env.JOMOK_SRC ?? "C:/Users/User/Downloads/jomok";
const REPORTS = path.join(ROOT, "data", "reports");
const OCR_JSON = path.join(REPORTS, "jomok-ocr.json");
const REVIEW_CSV = path.join(REPORTS, "jomok-review.csv");
const DUPES_JSON = path.join(REPORTS, "jomok-dupes.json");
const SHORT_JSON = path.join(REPORTS, "jomok-short.json");
const HASHES_JSON = path.join(REPORTS, "jomok-hashes.json");
const CROPS_DIR = path.join(REPORTS, "jomok-crops");
const MANIFEST_OUT = path.join(ROOT, "data", "groups", "meme", "jomok.json");
const RAW_DIR = path.join(ROOT, "assets", "raw");
const GROUP_ID = "jomok";

function escCsv(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: OcrRow[]): string {
  const head = "source_file,ocr_name,confidence,hash8,member_id,member_name,needs_review,reasons";
  const lines = rows.map((r) =>
    [
      r.sourceFile,
      r.ocrName,
      Math.round(r.confidence),
      r.hash.slice(0, 8),
      r.memberId,
      r.memberName,
      r.needsReview ? 1 : 0,
      r.reasons.join("|"),
    ]
      .map(escCsv)
      .join(","),
  );
  return `${head}\n${lines.join("\n")}\n`;
}

function parseCsv(text: string): OcrRow[] {
  const lines = text.trim().split("\n");
  lines.shift();
  const rows: OcrRow[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    // member names are OCR text; assume no embedded commas (re-run --ocr if violated).
    const parts = line.split(",");
    if (parts.length !== 8) throw new Error(`jomok-prep: malformed CSV line: ${line}`);
    const [sourceFile, ocrName, conf, hash8, memberId, memberName, needsReview, reasons] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    rows.push({
      sourceFile,
      ocrName,
      confidence: Number(conf),
      hash: hash8,
      memberId,
      memberName,
      needsReview: needsReview === "1",
      reasons: reasons === "" ? [] : reasons.split("|"),
    });
  }
  return rows;
}

async function runOcr(): Promise<void> {
  const skipOcr = process.env.SKIP_OCR === "1";
  const files = (await readdir(SRC)).filter((f) => /_n\.jpg$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`jomok-prep: no *_n.jpg files in ${SRC}`);
  console.log(`jomok-prep --ocr: ${files.length} files from ${SRC}`);

  const worker = skipOcr ? null : await createWorker("eng", OEM.LSTM_ONLY);
  if (worker !== null) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  }

  const decoded: Array<{ file: string; fallback: boolean; crop: Buffer }> = [];
  const rawEntries: Array<{ sourceFile: string; ocrName: string; confidence: number; hash: string }> = [];
  for (const file of files) {
    const img = await loadImage(path.join(SRC, file));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height);
    const { photoEnd, nameEnd, fallback } = detectDividers(pixels.data, img.width, img.height);
    const crop = cropPhoto(img, photoEnd);
    decoded.push({ file, fallback, crop });

    let ocrName = "";
    let confidence = 0;
    if (worker !== null) {
      const band = nameBand(img, photoEnd, nameEnd);
      const { data } = await worker.recognize(band);
      ocrName = cleanOcrName(data.text);
      confidence = data.confidence;
    }
    rawEntries.push({ sourceFile: file, ocrName, confidence, hash: hashBytes(crop) });
  }
  if (worker !== null) await worker.terminate();
  const fallbacks = decoded.filter((d) => d.fallback).length;

  const rows = assignMemberIds(rawEntries);

  await mkdir(REPORTS, { recursive: true });
  await mkdir(CROPS_DIR, { recursive: true });
  await writeFile(OCR_JSON, JSON.stringify({ src: SRC, files: rawEntries.map((e) => e.sourceFile) }, null, 2));
  await writeFile(
    REVIEW_CSV,
    toCsv(
      [...rows].sort(
        (a, b) => Number(b.needsReview) - Number(a.needsReview) || a.confidence - b.confidence,
      ),
    ),
  );
  await writeFile(HASHES_JSON, JSON.stringify(Object.fromEntries(rawEntries.map((e) => [e.sourceFile, e.hash])), null, 2));
  for (const d of decoded) {
    await writeFile(path.join(CROPS_DIR, d.file), d.crop);
  }

  const review = rows.filter((r) => r.needsReview).length;
  console.log(`ocr done: ${rows.length} rows, ${review} need review, ${fallbacks} divider fallbacks`);
  console.log(`edit member_id/member_name in ${REVIEW_CSV}, then run --build`);
}

interface BuiltPhoto {
  photoNo: number;
  rarity: RarityKey;
  imageUrl: string;
  sourcePageUrl: string;
  license: null;
  author: null;
}

interface BuiltMember {
  id: string;
  name: string;
  fullName: string;
  photos: BuiltPhoto[];
}

async function runBuild(): Promise<void> {
  const csv = await readFile(REVIEW_CSV, "utf8").catch(() => {
    throw new Error(`jomok-prep: ${REVIEW_CSV} not found, run --ocr first`);
  });
  const edited = parseCsv(csv);
  const hashes = JSON.parse(await readFile(HASHES_JSON, "utf8")) as Record<string, string>;
  for (const row of edited) {
    const full = hashes[row.sourceFile];
    if (full === undefined) throw new Error(`jomok-prep: no hash for ${row.sourceFile}, re-run --ocr`);
    row.hash = full;
    row.memberId = row.memberId.trim();
    row.memberName = row.memberName.trim();
    if (row.memberId === "" || row.memberName === "") {
      throw new Error(`jomok-prep: empty member_id/member_name for ${row.sourceFile} (delete the row to skip)`);
    }
  }

  // Survey reality: 108 unique faces (no repeat characters), so per-name members
  // would all be schema-invalid singletons. Chunk alphabetically into Mix members
  // of 6: per-member rarity = 2 common + 2 rare + 1 super_rare + 1 ultra_rare.
  const CHUNK = 6;
  const byName = [...edited].sort((a, b) =>
    a.memberName < b.memberName ? -1 : a.memberName > b.memberName ? 1 : 0,
  );
  const chunks: OcrRow[][] = [];
  for (let i = 0; i < byName.length; i += CHUNK) {
    const last = byName.slice(i, i + CHUNK);
    if (last.length < 3 && chunks.length > 0) {
      chunks[chunks.length - 1]?.push(...last);
    } else {
      chunks.push(last);
    }
  }

  const groups = groupRows(
    chunks.flatMap((rows, ci) => {
      const mixId = `jomok-mix-${String(ci + 1).padStart(2, "0")}`;
      return rows.map((r) => ({ ...r, memberId: mixId }));
    }),
  );
  await mkdir(RAW_DIR, { recursive: true });

  const members: BuiltMember[] = [];
  const short: Array<{ memberId: string; memberName: string; files: string[] }> = [];
  const dupes: Record<string, string[]> = {};

  const sorted = [...groups.values()].sort((a, b) =>
    a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0,
  );
  for (const g of sorted) {
    if (g.dupes.length > 0) dupes[g.memberId] = g.dupes;
    if (g.rows.length < 3) {
      short.push({ memberId: g.memberId, memberName: g.memberName, files: g.rows.map((r) => r.sourceFile) });
      continue;
    }
    const mixNames = g.rows.map((r) => r.memberName).join(" · ");
    const mixLabel = `Jomok Mix ${g.memberId.slice(-2)}`;
    members.push({
      id: g.memberId,
      name: mixLabel,
      fullName: mixNames,
      photos: g.rows.map((row, i) => {
        const photoNo = i + 1;
        const cardId = cardIdFor(g.memberId, photoNo);
        return {
          photoNo,
          rarity: rarityFor(photoNo),
          imageUrl: `https://example.com/jomok/${cardId}`,
          sourcePageUrl: `https://example.com/jomok/${row.sourceFile}`,
          license: null,
          author: null,
        };
      }),
    });
  }

  const manifest = {
    schemaVersion: 1,
    pool: "meme",
    group: { id: GROUP_ID, name: "Jomok", badge: "JOMOK" },
    members,
  };
  const parsed = groupManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(`jomok-prep: manifest invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }

  // write crops only after manifest validates
  for (const m of members) {
    const g = groups.get(m.id);
    if (g === undefined) continue;
    for (let i = 0; i < g.rows.length; i++) {
      const row = g.rows[i];
      if (row === undefined) continue;
      const cardId = cardIdFor(m.id, i + 1);
      await copyFile(path.join(CROPS_DIR, row.sourceFile), path.join(RAW_DIR, `${cardId}.jpg`));
    }
  }
  await writeFile(MANIFEST_OUT, JSON.stringify(parsed.data, null, 2));
  await writeFile(DUPES_JSON, JSON.stringify(dupes, null, 2));
  await writeFile(SHORT_JSON, JSON.stringify(short, null, 2));

  const photos = members.reduce((s, m) => s + m.photos.length, 0);
  const skipped = short.reduce((s, m) => s + m.files.length, 0);
  console.log(
    `build done: ${members.length} members, ${photos} photos -> ${MANIFEST_OUT}` +
      ` (short: ${short.length} members/${skipped} photos, dupes: ${Object.values(dupes).flat().length})`,
  );
}

const mode = process.argv[2];
if (mode === "--ocr") await runOcr();
else if (mode === "--build") await runBuild();
else {
  console.error("usage: jomok-prep.ts --ocr | --build");
  process.exit(1);
}
