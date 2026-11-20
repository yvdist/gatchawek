import { pickIndex, type RarityKey } from "./rarity.js";

export const PAMER_TITLE_PREFIX: Record<RarityKey, string> = {
  secret: "💠 SECRET FLEX",
  holo: "💎 HOLO FLEX",
  ultra_rare: "🌟 ULTRA FLEX",
  super_rare: "🔥 SUPER FLEX",
  rare: "✨ Pamer",
  common: "🎴 Pamer",
};

export const PAMER_HYPE: Record<RarityKey, readonly [string, string, string]> = {
  secret: [
    "💠 SECRET BINTANG ENAM TURUN 💠",
    "🌌 KARTU PALING LANGKA SERVER 🌌",
    "👑 CUMA 0,5% YANG SEBERUNTUNG INI 👑",
  ],
  holo: [
    "💎 HOLO BINTANG LIMA TURUN GUNUNG 💎",
    "🌈 KILAU HOLO BIKIN SILAU 🌈",
    "👑 DEWA GACHA SUDAH BERKATA 👑",
  ],
  ultra_rare: ["🚨 BREWEK SEJATI DATANG 🚨", "🌟 LANGKA PARAH, JANGAN IRI 🌟", "👑 MAHKOTA KOLEKSI GUA 👑"],
  super_rare: ["🔥 SUPER RARE NIH BOS 🔥", "💛 EMAS-EMAS GIMANA GINI 💛", "😤 YANG LAIN MINGGIR DULU 😤"],
  rare: ["✨ RARE JUGA PATUT PAMER ✨", "😌 DIKIT-DIKIT JADI BUKIT 😌", "📈 HOKI LAGI NAIK NIH 📈"],
  common: ["🎴 COMMON TAPI SAYANG 🎴", "🤏 PEMANASAN SEBELUM HOKI 🤏", "💪 YANG PENTING PD DULU 💪"],
};

/** `rand` in [0,1); pure — handler passes crypto randomness, tests pass fixed values. */
export function pickHype(rarity: RarityKey, rand: number): string {
  const lines = PAMER_HYPE[rarity];
  return lines[pickIndex(rand, lines.length)] as string;
}

export const PAMER_CAPTION_MAX = 140;

/** Trim + collapse whitespace, cap 140 chars; empty → null (no caption line). */
export function sanitizeCaption(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean === "") return null;
  return clean.slice(0, PAMER_CAPTION_MAX);
}
