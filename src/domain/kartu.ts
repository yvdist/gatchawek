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
