import type { APIEmbed } from "discord-api-types/v10";
import {
  RARITY_KEYS,
  RARITY_LABEL,
  RARITY_STARS,
  RARITY_WEIGHTS,
} from "../domain/rarity.js";
import type { HelpCatalog } from "../db/queries/koleksi.js";

export interface HelpEmbedArgs {
  userId: string;
  catalog: HelpCatalog;
  baseUrl: string;
}

function rateTable(): string {
  const total = RARITY_KEYS.reduce((sum, k) => sum + RARITY_WEIGHTS[k], 0);
  return RARITY_KEYS.map((key) => {
    const pct = total > 0 ? Math.round((RARITY_WEIGHTS[key] / total) * 100) : 0;
    return `${RARITY_STARS[key]} ${RARITY_LABEL[key]} — ${pct}%`;
  }).join("\n");
}

function catalogLines(catalog: HelpCatalog): string {
  if (catalog.pools.length === 0) return "Katalog belum tersedia.";
  return catalog.pools
    .map((pool) => {
      const groups =
        pool.groups.length === 0
          ? "belum ada seri"
          : pool.groups
              .map((g) => `${g.badge} ${g.name} (${g.memberCount} member)`)
              .join(" · ");
      return `${pool.emoji} **${pool.name}** — ${groups}`;
    })
    .join("\n");
}

export function buildHelpEmbed(args: HelpEmbedArgs): APIEmbed {
  const description = [
    `<@${args.userId}>`,
    "",
    "**Cara main**",
    "`/gacha pool:X` — tarik satu photocard dari pool X.",
    "`/koleksi` — lihat koleksimu (filter pool/grup, 8 member per halaman).",
    "`/status` — sisa tarik, cooldown reset, dan progres tiap pool.",
    "`/reset` — isi ulang stamina pool (ada cooldown).",
    "`/ping` — cek bot hidup.",
    "Tombol Tarik Lagi hanya bisa diklik pemiliknya.",
    "",
    "**Rate rarity**",
    rateTable(),
    "",
    "**Daftar seri**",
    catalogLines(args.catalog),
  ].join("\n");
  return {
    title: "📖 Bantuan Photocard Bot",
    description,
    footer: { text: `Gambar: https://${args.baseUrl}/cards/…` },
  };
}
