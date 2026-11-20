import {
  RARITY_KEYS,
  type RarityKey,
} from "../../shared/manifest.schema.js";
import { slugifyMemberId } from "./discover-commons.js";

/**
 * Pure parser for community-inject submissions posted in Discord.
 * No fs, no network: takes the message text + attachment metadata,
 * returns either a validated submission or a list of human-readable errors.
 * No imports from db/ or discord/ (layer rule).
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

export interface ParsedSubmission {
  nama: string;
  memberId: string;
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

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  return URL.canParse(value);
}

function isRarityKey(value: string): value is RarityKey {
  return (RARITY_KEYS as readonly string[]).includes(value);
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
  const grup = fields.get("grup") ?? "";
  const rarityRaw = fields.get("rarity") ?? "";
  if (nama === "") errors.push("missing required field [nama]");
  if (grup === "") errors.push("missing required field [grup]");

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

  if (errors.length > 0 || rarity === null || image === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      nama,
      memberId: slugifyMemberId(nama, new Set()),
      grup,
      rarity,
      label,
      sumber,
      imageUrl: image.url,
      messageUrl,
    },
  };
}
