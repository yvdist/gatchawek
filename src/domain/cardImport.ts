import type { RarityKey } from "./rarity.js";
import { slugifyBase } from "./submissions.js";

/**
 * Pure parser for filename-template GUI card imports: `(rarity) - nama grup - nama kartu.ext`.
 * The group segment is optional: `(rarity) - nama kartu.ext` stays valid and
 * falls back to the dropdown target (legacy 2-segment form).
 * No fs, no network, no db/hono imports (layer rule).
 */

export interface ParsedFilenameCard {
  originalFilename: string;
  nama: string;
  memberId: string;
  rarity: RarityKey | null;
  rawRarity: string | null;
  group: string | null;
  rawGroup: string | null;
  templateMatched: boolean;
}

const RARITY_ALIAS_MAP: Readonly<Record<string, RarityKey>> = {
  common: "common",
  c: "common",
  "1": "common",
  "★": "common",
  "*": "common",
  bintang_1: "common",
  rare: "rare",
  r: "rare",
  "2": "rare",
  "★★": "rare",
  "**": "rare",
  bintang_2: "rare",
  super_rare: "super_rare",
  sr: "super_rare",
  "3": "super_rare",
  "★★★": "super_rare",
  "***": "super_rare",
  bintang_3: "super_rare",
  ultra_rare: "ultra_rare",
  ur: "ultra_rare",
  "4": "ultra_rare",
  "★★★★": "ultra_rare",
  "****": "ultra_rare",
  bintang_4: "ultra_rare",
  holo: "holo",
  h: "holo",
  holographic: "holo",
  ssr: "holo",
  "5": "holo",
  "★★★★★": "holo",
  "*****": "holo",
  bintang_5: "holo",
  secret: "secret",
  s: "secret",
  scr: "secret",
  "6": "secret",
  bintang_6: "secret",
  "★★★★★★": "secret",
  "******": "secret",
};

const TEMPLATE_RE =
  /^\s*[([]([^)\]]+?)[)\]]\s*(?:[-–—_:]+\s*|\s+)(.+?)\s*$/;

/**
 * Split the remainder after the rarity bracket: segments separated by dashes
 * with required surrounding whitespace. The whitespace requirement keeps
 * slugs such as `kabinet-merah-putih` intact. Two or more segments means the
 * first is the group name and the rest rejoin as the card name; a single
 * segment is the legacy 2-segment form (`group` stays null).
 */
function splitGroupAndName(rest: string): { group: string | null; name: string } {
  const parts = rest
    .split(/\s+[-–—:]+\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length >= 2) {
    const group = parts[0] ?? null;
    const nameParts = parts.slice(1);
    return { group: group === "" ? null : group, name: nameParts.join(" - ") };
  }
  return { group: null, name: rest.trim() };
}

/** Parse a rarity name or shorthand alias into a canonical `RarityKey`. */
export function parseRarityAlias(raw: string): RarityKey | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "") return null;
  return RARITY_ALIAS_MAP[key] ?? null;
}

/** Normalize separators (`_`, `-`) to spaces and convert words to Title Case. */
export function toTitleCase(raw: string): string {
  const cleaned = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned === "") return "";
  return cleaned
    .split(" ")
    .map((word) => {
      const first = word.charAt(0).toUpperCase();
      const rest = word.slice(1).toLowerCase();
      return `${first}${rest}`;
    })
    .join(" ");
}

/**
 * Parse a dropped filename against the `(rarity) - [grup -] nama kartu.ext`
 * template. Always produces a best-effort `nama` and `memberId`, setting
 * `templateMatched` true only when both a valid rarity alias and a non-empty
 * card name exist (the group segment is optional).
 */
export function parseCardFilename(filename: string): ParsedFilenameCard {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const stem = base.replace(/\.[^.]+$/, "");
  const match = TEMPLATE_RE.exec(stem);
  if (match !== null) {
    const rawRarity = (match[1] ?? "").trim();
    const rest = match[2] ?? "";
    const rarity = parseRarityAlias(rawRarity);
    const { group, name } = splitGroupAndName(rest);
    const nama = toTitleCase(name);
    const rawGroup = group === null ? null : group;
    return {
      originalFilename: filename,
      nama,
      memberId: slugifyBase(nama),
      rarity,
      rawRarity,
      group: rawGroup === null ? null : toTitleCase(rawGroup),
      rawGroup,
      templateMatched: rarity !== null && nama !== "",
    };
  }
  const nama = toTitleCase(stem);
  return {
    originalFilename: filename,
    nama,
    memberId: slugifyBase(nama),
    rarity: null,
    rawRarity: null,
    group: null,
    rawGroup: null,
    templateMatched: false,
  };
}
