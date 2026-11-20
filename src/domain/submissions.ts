import {
  RARITY_KEYS,
  type RarityKey,
} from "../../shared/manifest.schema.js";

/**
 * Pure parser for community-inject submissions posted in Discord.
 * No fs, no network, no node imports: shared by scripts/ingest.ts and the
 * Worker scheduled ingest. No imports from db/ or discord/ (layer rule).
 */

export interface SubmissionAttachment {
  url: string;
  filename: string;
  contentType?: string | null;
}

export interface ParseSubmissionInput {
  content: string;
  attachments: readonly SubmissionAttachment[];
  guildId: string;
  channelId: string;
  messageId: string;
}

/** One card entry inside a bulk JSON attachment. Field-level defaults
 * (pool/grup/rarity/sumber) come from the message template; the entry only
 * carries per-card data. */
export interface BulkCardEntry {
  nama: string;
  imageUrl: string;
  label?: string | null;
  sumber?: string | null;
}

export interface ParsedBulkSubmission {
  cards: ParsedSubmission[];
}

export type ParseBulkResult =
  | { ok: true; value: ParsedBulkSubmission }
  | { ok: false; errors: string[] };

export const BULK_MAX_CARDS = 50;

export type PoolChoice = "pejabat" | "meme";

/** Fixed pool → curated group mapping. Single source for the template text,
 * the parser, approve paths, and Worker ingest (no pool/group ids hardcoded
 * elsewhere). */
export const POOL_GROUPS: Record<PoolChoice, string> = {
  pejabat: "kabinet-merah-putih",
  meme: "jomok",
};

export interface ParsedSubmission {
  nama: string;
  memberId: string;
  pool: PoolChoice;
  grup: string;
  rarity: RarityKey;
  label: string | null;
  sumber: string;
  imageUrl: string;
  messageUrl: string;
}

export type ParseSubmissionResult =
  | { ok: true; value: ParsedSubmission }
  | { ok: false; errors: string[] };

const FIELD_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const MAX_LABEL = 60;

/** Template shown to contributors when their message is rejected. */
export const SUBMISSION_TEMPLATE = [
  "[nama] Nama Lengkap",
  "[pool] pejabat",
  "[grup] kabinet-merah-putih",
  "[rarity] rare",
  "[label] (opsional, maks 60 karakter)",
  "[sumber] (opsional, link https)",
].join("\n");

/**
 * Pure reply text for a rejected submission: specific reasons first, then the
 * correct template. No pool/grup ids beyond the fixed POOL_GROUPS choice.
 */
export function formatRejectionReply(errors: readonly string[]): string {
  const reasons = errors.map((e) => `- ${e}`).join("\n");
  return [
    "❌ Kartu tidak bisa diproses:",
    reasons,
    "",
    "Template yang benar (copy-paste, timpa yang dalam kurung, upload tepat 1 gambar):",
    "```",
    SUBMISSION_TEMPLATE,
    "```",
    "Aturan: [pool] pejabat → [grup] kabinet-merah-putih, [pool] meme → [grup] jomok; [rarity] common/rare/super_rare/ultra_rare.",
  ].join("\n");
}

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  return URL.canParse(value);
}

function isRarityKey(value: string): value is RarityKey {
  return (RARITY_KEYS as readonly string[]).includes(value);
}

/** Base slug without uniqueness suffixes (Worker has no registry to check). */
export function slugifyBase(fullName: string): string {
  let slug = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > 30) slug = slug.slice(0, 30).replace(/-+$/g, "");
  if (slug === "") slug = "member";
  return slug;
}

export function parseSubmission(
  input: ParseSubmissionInput,
): ParseSubmissionResult {
  const errors: string[] = [];
  const fields = new Map<string, string>();
  for (const line of input.content.split(/\r?\n/)) {
    const match = FIELD_RE.exec(line);
    if (match === null) continue;
    const key = (match[1] ?? "").trim().toLowerCase();
    const value = (match[2] ?? "").trim();
    if (key !== "") fields.set(key, value);
  }

  const nama = fields.get("nama") ?? "";
  const poolRaw = fields.get("pool") ?? "";
  const grupRaw = fields.get("grup") ?? "";
  if (nama === "") errors.push("missing required field [nama]");

  let pool: PoolChoice | null = null;
  if (poolRaw === "") {
    errors.push("missing required field [pool]");
  } else {
    const normalized = poolRaw.toLowerCase();
    if (normalized !== "pejabat" && normalized !== "meme") {
      errors.push(`invalid [pool] "${poolRaw}": must be pejabat or meme`);
    } else {
      pool = normalized;
    }
  }

  let grup: string | null = null;
  if (grupRaw === "") {
    errors.push("missing required field [grup]");
  } else if (pool !== null) {
    const expected = POOL_GROUPS[pool];
    if (grupRaw.toLowerCase() !== expected) {
      errors.push(
        `invalid [grup] "${grupRaw}" for pool "${pool}": must be ${expected}`,
      );
    } else {
      grup = expected;
    }
  }

  const rarityRaw = fields.get("rarity") ?? "";
  let rarity: RarityKey | null = null;
  if (rarityRaw === "") {
    errors.push("missing required field [rarity]");
  } else {
    const normalized = rarityRaw.toLowerCase();
    if (!isRarityKey(normalized)) {
      errors.push(
        `invalid [rarity] "${rarityRaw}": must be one of ${RARITY_KEYS.join(", ")}`,
      );
    } else {
      rarity = normalized;
    }
  }

  const labelRaw = fields.get("label") ?? "";
  let label: string | null = null;
  if (labelRaw !== "") {
    if (labelRaw.length > MAX_LABEL) {
      errors.push(
        `invalid [label]: max ${String(MAX_LABEL)} chars (found ${String(labelRaw.length)})`,
      );
    } else {
      label = labelRaw;
    }
  }

  const messageUrl = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
  const sumberRaw = fields.get("sumber") ?? "";
  let sumber = messageUrl;
  if (sumberRaw !== "") {
    if (!isHttpsUrl(sumberRaw)) {
      errors.push(`invalid [sumber]: must be an https URL`);
    } else {
      sumber = sumberRaw;
    }
  }

  const images = input.attachments.filter((a) =>
    (a.contentType ?? "").startsWith("image/"),
  );
  if (images.length !== 1) {
    errors.push(
      `expected exactly 1 image attachment, found ${String(images.length)}`,
    );
  }
  const image = images[0];
  if (image !== undefined && !image.url.startsWith("https://")) {
    errors.push("image attachment url must be an https URL");
  }

  if (errors.length > 0 || rarity === null || image === undefined || pool === null || grup === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      nama,
      memberId: slugifyBase(nama),
      pool,
      grup,
      rarity,
      label,
      sumber,
      imageUrl: image.url,
      messageUrl,
    },
  };

}
/** Bulk template header: pool/grup/rarity/sumber defaults shared by every
 * card in the attached JSON file. `[bulk-json]` marks the message so the
 * single-photo path ignores it and vice versa. */
export const BULK_TEMPLATE = [
  "[bulk-json]",
  "[pool] pejabat",
  "[grup] kabinet-merah-putih",
  "[rarity] rare",
  "[sumber] (opsional, link https — default tiap kartu)",
  "(lampirkan 1 file .json: array [{nama, imageUrl, label?, sumber?}], maks 50 kartu)",
].join("\n");

export function formatBulkRejectionReply(errors: readonly string[]): string {
  const reasons = errors.map((e) => `- ${e}`).join("\n");
  return [
    "❌ File bulk tidak bisa diproses:",
    reasons,
    "",
    "Template yang benar:",
    "```",
    BULK_TEMPLATE,
    "```",
    'Contoh isi file .json: [{"nama": "Nama Lengkap", "imageUrl": "https://…"}]',
  ].join("\n");
}

function isBulkEntry(value: unknown): value is BulkCardEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["nama"] === "string" && typeof v["imageUrl"] === "string";
}

/**
 * Parse a bulk message: template fields give pool/grup/rarity/default sumber,
 * the single .json attachment gives the per-card rows. JSON text is fetched
 * by the caller (pure: no fetch here); pass it via `jsonText`. Returns one
 * ParsedSubmission per card, sharing defaults, each with its own imageUrl.
 */
export function parseBulkSubmission(
  input: ParseSubmissionInput & { jsonText: string },
): ParseBulkResult {
  const errors: string[] = [];
  const fields = new Map<string, string>();
  for (const line of input.content.split(/\r?\n/)) {
    const match = FIELD_RE.exec(line);
    if (match === null) continue;
    const key = (match[1] ?? "").trim().toLowerCase();
    const value = (match[2] ?? "").trim();
    if (key !== "") fields.set(key, value);
  }
  const poolRaw = fields.get("pool") ?? "";
  let pool: PoolChoice | null = null;
  if (poolRaw === "") {
    errors.push("missing required field [pool]");
  } else {
    const normalized = poolRaw.toLowerCase();
    if (normalized !== "pejabat" && normalized !== "meme") {
      errors.push(`invalid [pool] "${poolRaw}": must be pejabat or meme`);
    } else {
      pool = normalized;
    }
  }
  let grup: string | null = null;
  const grupRaw = fields.get("grup") ?? "";
  if (grupRaw === "") {
    errors.push("missing required field [grup]");
  } else if (pool !== null) {
    const expected = POOL_GROUPS[pool];
    if (grupRaw.toLowerCase() !== expected) {
      errors.push(`invalid [grup] "${grupRaw}" for pool "${pool}": must be ${expected}`);
    } else {
      grup = expected;
    }
  }
  const rarityRaw = fields.get("rarity") ?? "";
  let rarity: RarityKey | null = null;
  if (rarityRaw === "") {
    errors.push("missing required field [rarity]");
  } else {
    const normalized = rarityRaw.toLowerCase();
    if (!isRarityKey(normalized)) {
      errors.push(`invalid [rarity] "${rarityRaw}": must be one of ${RARITY_KEYS.join(", ")}`);
    } else {
      rarity = normalized;
    }
  }
  const messageUrl = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
  const sumberRaw = fields.get("sumber") ?? "";
  let defaultSumber = messageUrl;
  if (sumberRaw !== "") {
    if (!isHttpsUrl(sumberRaw)) {
      errors.push(`invalid [sumber]: must be an https URL`);
    } else {
      defaultSumber = sumberRaw;
    }
  }
  const jsonFiles = input.attachments.filter((a) =>
    a.filename.toLowerCase().endsWith(".json"),
  );
  if (jsonFiles.length !== 1) {
    errors.push(`expected exactly 1 .json attachment, found ${String(jsonFiles.length)}`);
  }
  let raw: unknown = null;
  if (input.jsonText.trim() === "") {
    errors.push("bulk .json attachment is empty or could not be downloaded");
  } else {
    try {
      raw = JSON.parse(input.jsonText) as unknown;
    } catch {
      errors.push("bulk .json is not valid JSON");
    }
  }
  if (!Array.isArray(raw)) {
    if (raw !== null) errors.push("bulk .json must be an array of {nama, imageUrl, label?, sumber?}");
  }
  const rows: unknown[] = Array.isArray(raw) ? raw : [];
  if (rows.length < 1 || rows.length > BULK_MAX_CARDS) {
    errors.push(`expected 1-${String(BULK_MAX_CARDS)} cards in bulk .json, found ${String(rows.length)}`);
  }
  if (errors.length > 0 || pool === null || grup === null || rarity === null) {
    return { ok: false, errors };
  }
  const cards: ParsedSubmission[] = [];
  rows.forEach((row, i) => {
    const tag = `row ${String(i + 1)}`;
    if (!isBulkEntry(row)) {
      errors.push(`${tag}: must be {nama: string, imageUrl: https URL, label?: string, sumber?: https URL}`);
      return;
    }
    const nama = row.nama.trim();
    if (nama === "") {
      errors.push(`${tag}: nama must not be empty`);
      return;
    }
    if (!row.imageUrl.startsWith("https://")) {
      errors.push(`${tag}: imageUrl must be an https URL`);
      return;
    }
    let label: string | null = null;
    if (row.label !== undefined && row.label !== null) {
      if (row.label.length > MAX_LABEL) {
        errors.push(`${tag}: label max ${String(MAX_LABEL)} chars (found ${String(row.label.length)})`);
        return;
      }
      label = row.label;
    }
    let sumber = defaultSumber;
    if (row.sumber !== undefined && row.sumber !== null && row.sumber !== "") {
      if (!isHttpsUrl(row.sumber)) {
        errors.push(`${tag}: sumber must be an https URL`);
        return;
      }
      sumber = row.sumber;
    }
    cards.push({
      nama,
      memberId: slugifyBase(nama),
      pool,
      grup,
      rarity,
      label,
      sumber,
      imageUrl: row.imageUrl,
      messageUrl,
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { cards } };
}
