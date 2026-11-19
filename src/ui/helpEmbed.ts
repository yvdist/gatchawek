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
  commands: readonly { name: string; description: string }[];
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
  // Discord caps embed descriptions at 4096 chars; keep the catalog well
  // under it so pool/group growth never breaks /help.
  const MAX_CATALOG = 3000;
  const lines: string[] = [];
  let used = 0;
  let hidden = 0;
  for (const pool of catalog.pools) {
    const groups =
      pool.groups.length === 0
        ? "belum ada seri"
        : pool.groups
            .map((g) => `${g.badge} ${g.name} (${g.memberCount} member)`)
            .join(" · ");
    const line = `${pool.emoji} **${pool.name}** — ${groups}`;
    if (used + line.length + 1 > MAX_CATALOG) {
      hidden += catalog.pools.length - lines.length;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (hidden > 0) lines.push(`… (+${hidden} pool lagi)`);
  return lines.join("\n");
}

export function buildHelpEmbed(args: HelpEmbedArgs): APIEmbed {
  const commandLines =
    "**Daftar command**\n" +
    args.commands.map((c) => `\`/${c.name}\` — ${c.description}`).join("\n");
  const description = [
    `<@${args.userId}>`,
    "",
    "**Cara main**",
    commandLines,
    "`/trade user:@teman offer:X request:Y` — tukar kartu; target klik ✅ Terima / ❌ Tolak, proposer klik 🚫 Batal.",
    "`/help` — tampilkan panduan ini.",
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
