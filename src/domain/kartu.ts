import { RARITY_KEYS, type RarityKey } from "./rarity.js";

const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

const INDONESIAN_CITIES = [
  "Palembang",
  "Bandung",
  "Surabaya",
  "Yogyakarta",
  "Medan",
  "Semarang",
  "Makassar",
  "Malang",
  "Denpasar",
  "Surakarta",
  "Bogor",
  "Padang",
  "Balikpapan",
  "Pontianak",
  "Manado",
  "Pekanbaru",
  "Banjarmasin",
  "Bekasi",
  "Depok",
  "Tangerang",
] as const;

const BLOOD_TYPES = ["A", "B", "AB", "O"] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export interface JabatanInfo {
  readonly title: string;
  readonly colorHex: string;
}

export interface TopPoolSummary {
  readonly poolName: string;
  readonly ownedMembers: number;
  readonly totalMembers: number;
}

export function fnv1a32(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic 10-digit Nomor Induk Member (NIM) derived from Discord user ID. */
export function deriveNim(userId: string): string {
  const h1 = fnv1a32(`nim-hi:${userId}`);
  const h2 = fnv1a32(`nim-lo:${userId}`);
  const firstDigit = (h1 % 9) + 1;
  const rest = (h2 % 1_000_000_000).toString().padStart(9, "0");
  return `${firstDigit}${rest}`;
}

export function deriveBloodType(userId: string): BloodType {
  const h = fnv1a32(`blood:${userId}`);
  return BLOOD_TYPES[h % BLOOD_TYPES.length] ?? "O";
}

export function deriveBirthInfo(userId: string): string {
  const hCity = fnv1a32(`city:${userId}`);
  const hDate = fnv1a32(`date:${userId}`);
  const city = INDONESIAN_CITIES[hCity % INDONESIAN_CITIES.length] ?? "Jakarta";
  const day = (hDate % 28) + 1;
  const month =
    INDONESIAN_MONTHS[(hDate >>> 5) % INDONESIAN_MONTHS.length] ?? "Juli";
  const year = 1995 + ((hDate >>> 10) % 11);
  return `${city}, ${day} ${month} ${year}`;
}

/** Formats Unix timestamp (seconds) in WIB (UTC+7) as e.g. "1 April 2026". */
export function formatIndonesianDate(unixSec: number): string {
  const safeSec = Number.isFinite(unixSec) && unixSec > 0 ? unixSec : 0;
  const wibMs = (safeSec + 7 * 3600) * 1000;
  const d = new Date(wibMs);
  const day = d.getUTCDate();
  const month = INDONESIAN_MONTHS[d.getUTCMonth()] ?? "Januari";
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function resolveJoinTimestamp(
  joinedAtIso: string | null | undefined,
  userCreatedAt: number | null,
  firstCardAt: number | null,
  nowSec: number,
): number {
  if (typeof joinedAtIso === "string" && joinedAtIso.trim() !== "") {
    const parsedMs = Date.parse(joinedAtIso);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.floor(parsedMs / 1000);
    }
  }
  const candidates = [userCreatedAt, firstCardAt].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
  if (candidates.length > 0) {
    return Math.min(...candidates);
  }
  return nowSec;
}

const JABATAN_BY_RARITY: Record<RarityKey, JabatanInfo> = {
  common: { title: "Commoner", colorHex: "#4ADE80" },
  rare: { title: "Kolektor Muda", colorHex: "#C084FC" },
  super_rare: { title: "Juragan Kartu", colorHex: "#FBBF24" },
  ultra_rare: { title: "Sultan Gacha", colorHex: "#F472B6" },
  holo: { title: "Pawang Holo", colorHex: "#FDE047" },
  secret: { title: "Sepuh Agung", colorHex: "#22D3EE" },
};

export function rarityRank(rarity: RarityKey): number {
  return RARITY_KEYS.indexOf(rarity);
}

export function computeJabatan(
  highestRarity: RarityKey | null,
  uniqueMembers: number,
): JabatanInfo {
  if (uniqueMembers <= 0 || highestRarity === null) {
    return { title: "Warga Sipil", colorHex: "#9CA3AF" };
  }
  return JABATAN_BY_RARITY[highestRarity];
}

export function formatAndalan(
  topMemberName: string | null,
  totalUniqueMembers: number,
): string {
  if (topMemberName === null || totalUniqueMembers <= 0) return "-";
  const clean = sanitizeAsciiText(topMemberName, 16);
  const others = Math.max(0, totalUniqueMembers - 1);
  if (others === 0) return clean;
  return `${clean} (+${others} lainnya)`;
}

export function formatPoolFavorit(topPool: TopPoolSummary | null): string {
  if (topPool === null || topPool.ownedMembers <= 0) return "-";
  const cleanName = sanitizeAsciiText(topPool.poolName, 14);
  return `${cleanName} (${topPool.ownedMembers}/${topPool.totalMembers})`;
}

export function formatKoleksiRingkas(
  totalCards: number,
  uniqueMembers: number,
  totalHolo: number,
): string {
  if (totalCards <= 0) return "Belum punya";
  if (totalHolo > 0) {
    return `${totalCards} Kartu (${totalHolo} Holo)`;
  }
  return `${totalCards} Kartu (${uniqueMembers} Tokoh)`;
}

export function sanitizeAsciiText(input: string, maxLen: number): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = normalized.length > 0 ? normalized : "-";
  if (fallback.length <= maxLen) return fallback;
  if (maxLen <= 3) return fallback.slice(0, maxLen);
  return `${fallback.slice(0, maxLen - 3).trimEnd()}...`;
}

/** Deterministic alternating bar/gap pixel widths for the bottom barcode strip. */
export function deriveBarcodeWidths(
  userId: string,
  targetWidth = 252,
): readonly number[] {
  const widths: number[] = [2, 1, 2, 1];
  let sum = 6;
  let step = 0;
  while (sum < targetWidth - 8) {
    const h = fnv1a32(`bar:${userId}:${step++}`);
    const barW = (h % 3) + 1;
    const gapW = ((h >>> 3) % 2) + 1;
    if (sum + barW + gapW > targetWidth - 6) break;
    widths.push(barW, gapW);
    sum += barW + gapW;
  }
  widths.push(2, 1, 2);
  return widths;
}

export const CARD_MOTIFS = [
  "orbital-spheres",
  "cyber-chevrons",
  "topographic-waves",
  "diamond-prism",
  "sunburst-rays",
  "hex-circuit",
] as const;

export type CardMotif = (typeof CARD_MOTIFS)[number];

export type RgbTuple = readonly [number, number, number];

export interface CardTheme {
  readonly paletteName: string;
  readonly motif: CardMotif;
  readonly gradientMode: 0 | 1 | 2 | 3;
  readonly bgStartRgb: RgbTuple;
  readonly bgEndRgb: RgbTuple;
  readonly shapeTintRgb: RgbTuple;
  readonly accentLineRgb: RgbTuple;
  readonly labelRgb: RgbTuple;
  readonly ringRgb: RgbTuple;
  readonly glowRgb: RgbTuple;
  readonly handleRgb: RgbTuple;
  readonly seedA: number;
  readonly seedB: number;
  readonly seedC: number;
}

interface PalettePreset {
  readonly name: string;
  readonly bgStart: RgbTuple;
  readonly bgEnd: RgbTuple;
  readonly shapeTint: RgbTuple;
  readonly accentLine: RgbTuple;
  readonly label: RgbTuple;
  readonly ring: RgbTuple;
  readonly glow: RgbTuple;
  readonly handle: RgbTuple;
}

const DEFAULT_PRESET: PalettePreset = {
  name: "Royal Plum",
  bgStart: [42, 19, 37],
  bgEnd: [82, 37, 71],
  shapeTint: [28, 13, 25],
  accentLine: [244, 114, 182],
  label: [226, 136, 208],
  ring: [252, 211, 238],
  glow: [244, 114, 182],
  handle: [232, 208, 226],
};

const PALETTE_PRESETS: readonly PalettePreset[] = [
  DEFAULT_PRESET,
  {
    name: "Cyber Midnight",
    bgStart: [13, 25, 48],
    bgEnd: [25, 58, 96],
    shapeTint: [12, 28, 44],
    accentLine: [34, 211, 238],
    label: [103, 232, 249],
    ring: [207, 250, 254],
    glow: [34, 211, 238],
    handle: [196, 234, 245],
  },
  {
    name: "Emerald Noir",
    bgStart: [12, 36, 28],
    bgEnd: [24, 74, 56],
    shapeTint: [10, 28, 21],
    accentLine: [52, 211, 153],
    label: [110, 231, 183],
    ring: [209, 250, 229],
    glow: [16, 185, 129],
    handle: [199, 238, 220],
  },
  {
    name: "Crimson Velvet",
    bgStart: [46, 14, 22],
    bgEnd: [92, 26, 40],
    shapeTint: [30, 10, 14],
    accentLine: [251, 113, 133],
    label: [253, 164, 175],
    ring: [255, 228, 230],
    glow: [244, 63, 94],
    handle: [245, 208, 214],
  },
  {
    name: "Amethyst Void",
    bgStart: [26, 16, 54],
    bgEnd: [56, 34, 104],
    shapeTint: [20, 13, 38],
    accentLine: [167, 139, 250],
    label: [196, 181, 253],
    ring: [237, 233, 254],
    glow: [139, 92, 246],
    handle: [221, 214, 248],
  },
  {
    name: "Ocean Abyss",
    bgStart: [11, 35, 46],
    bgEnd: [21, 74, 88],
    shapeTint: [10, 26, 32],
    accentLine: [45, 212, 191],
    label: [94, 234, 212],
    ring: [204, 251, 241],
    glow: [20, 184, 166],
    handle: [196, 238, 232],
  },
  {
    name: "Obsidian Ember",
    bgStart: [44, 22, 12],
    bgEnd: [88, 45, 22],
    shapeTint: [28, 15, 8],
    accentLine: [251, 146, 60],
    label: [253, 186, 116],
    ring: [255, 237, 213],
    glow: [249, 115, 22],
    handle: [245, 220, 196],
  },
  {
    name: "Golden Dynasty",
    bgStart: [38, 29, 14],
    bgEnd: [76, 58, 26],
    shapeTint: [24, 19, 9],
    accentLine: [250, 204, 21],
    label: [253, 224, 71],
    ring: [254, 249, 195],
    glow: [234, 179, 8],
    handle: [242, 232, 196],
  },
  {
    name: "Sakura Twilight",
    bgStart: [36, 20, 48],
    bgEnd: [78, 38, 86],
    shapeTint: [26, 12, 28],
    accentLine: [232, 121, 249],
    label: [240, 171, 252],
    ring: [250, 232, 255],
    glow: [217, 70, 239],
    handle: [238, 214, 245],
  },
  {
    name: "Arctic Cobalt",
    bgStart: [18, 26, 52],
    bgEnd: [38, 56, 108],
    shapeTint: [15, 20, 38],
    accentLine: [96, 165, 250],
    label: [147, 197, 253],
    ring: [219, 234, 254],
    glow: [59, 130, 246],
    handle: [208, 224, 248],
  },
  {
    name: "Matrix Jade",
    bgStart: [18, 34, 16],
    bgEnd: [38, 72, 32],
    shapeTint: [14, 26, 12],
    accentLine: [163, 230, 53],
    label: [190, 242, 100],
    ring: [236, 252, 203],
    glow: [132, 204, 22],
    handle: [218, 240, 192],
  },
  {
    name: "Cosmic Sunset",
    bgStart: [34, 16, 44],
    bgEnd: [86, 36, 54],
    shapeTint: [28, 14, 22],
    accentLine: [251, 113, 133],
    label: [249, 168, 212],
    ring: [252, 231, 243],
    glow: [236, 72, 153],
    handle: [240, 212, 226],
  },
];

function jitterChannel(base: number, hashBits: number, span: number): number {
  const delta = (hashBits % (span * 2 + 1)) - span;
  return Math.max(0, Math.min(255, base + delta));
}

/**
 * Derives a unique, deterministic visual theme & architectural background motif
 * for each member based on their Discord user ID.
 */
export function deriveCardTheme(userId: string): CardTheme {
  const hPalette = fnv1a32(`theme-pal:${userId}`);
  const hMotif = fnv1a32(`theme-motif:${userId}`);
  const seedA = fnv1a32(`theme-a:${userId}`);
  const seedB = fnv1a32(`theme-b:${userId}`);
  const seedC = fnv1a32(`theme-c:${userId}`);

  const preset =
    PALETTE_PRESETS[hPalette % PALETTE_PRESETS.length] ?? DEFAULT_PRESET;
  const motifIdx = (hMotif + (hPalette >>> 4)) % CARD_MOTIFS.length;
  const motif = CARD_MOTIFS[motifIdx] ?? "orbital-spheres";
  const gradientMode = ((seedA >>> 3) & 3) as 0 | 1 | 2 | 3;

  const bgStartRgb: RgbTuple = [
    jitterChannel(preset.bgStart[0], seedA & 0xff, 6),
    jitterChannel(preset.bgStart[1], (seedA >>> 8) & 0xff, 6),
    jitterChannel(preset.bgStart[2], (seedA >>> 16) & 0xff, 6),
  ];
  const bgEndRgb: RgbTuple = [
    jitterChannel(preset.bgEnd[0], seedB & 0xff, 8),
    jitterChannel(preset.bgEnd[1], (seedB >>> 8) & 0xff, 8),
    jitterChannel(preset.bgEnd[2], (seedB >>> 16) & 0xff, 8),
  ];

  return {
    paletteName: preset.name,
    motif,
    gradientMode,
    bgStartRgb,
    bgEndRgb,
    shapeTintRgb: preset.shapeTint,
    accentLineRgb: preset.accentLine,
    labelRgb: preset.label,
    ringRgb: preset.ring,
    glowRgb: preset.glow,
    handleRgb: preset.handle,
    seedA,
    seedB,
    seedC,
  };
}
