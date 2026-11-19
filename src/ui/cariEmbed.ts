import type { APIEmbed } from "discord-api-types/v10";
import { RARITY_STARS, type RarityKey } from "../domain/rarity.js";
import type { CariMember } from "../db/queries/cari.js";

export const CARI_MAX_MEMBERS = 3;

const RARITY_SHORT: Record<RarityKey, string> = {
  common: "C",
  rare: "R",
  super_rare: "SR",
  ultra_rare: "UR",
};

function cardLine(
  photoNo: number,
  rarity: RarityKey,
  owners: { userId: string; qty: number; holoQty: number }[],
): string {
  const stars = RARITY_STARS[rarity];
  if (owners.length === 0) {
    return `📸 Foto ${photoNo} · ${stars} — Belum ada yang punya`;
  }
  const parts = owners.map((o) => {
    const holo = o.holoQty > 0 ? ` (✦×${o.holoQty})` : "";
    return `<@${o.userId}> ×${o.qty + o.holoQty}${holo}`;
  });
  return `📸 Foto ${photoNo} · ${stars} (${RARITY_SHORT[rarity]}) · Punya: ${parts.join(", ")}`;
}

export function buildCariEmbed(
  members: CariMember[],
  query: string,
  truncated: number,
): APIEmbed {
  const shown = members.slice(0, CARI_MAX_MEMBERS);
  const lines: string[] = [];
  for (const m of shown) {
    lines.push(`**${m.memberName}** (${m.groupName})`);
    if (m.cards.length === 0) {
      lines.push("_Belum ada kartu._");
    } else {
      for (const c of m.cards) {
        lines.push(cardLine(c.photoNo, c.rarity, c.owners));
      }
    }
    lines.push("");
  }
  if (truncated > 0) {
    lines.push(`… +${truncated} lagi, persempit kata kunci.`);
  }
  const description =
    lines.join("\n").slice(0, 4000) || `Tidak ketemu "${query}".`;
  return {
    title: `🔍 Cari: ${query}`,
    description,
  };
}

export function buildCariEmpty(query: string): APIEmbed {
  return {
    title: `🔍 Cari: ${query}`,
    description: `Tidak ketemu "${query}". Coba nama lain.`,
  };
}
