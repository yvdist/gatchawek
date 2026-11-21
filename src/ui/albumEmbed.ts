import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithURL,
  type APIEmbed,
} from "discord-api-types/v10";
import type { AlbumSummaryStats } from "../db/queries/album.js";

export function buildAlbumUrl(base: string, token: string): string {
  const cleanBase = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${cleanBase}/album/${token}`;
}

export interface AlbumEmbedArgs {
  readonly userId: string;
  readonly albumUrl: string;
  readonly expiresAt: number;
  readonly poolName: string | null;
  readonly poolEmoji: string | null;
  readonly summary: AlbumSummaryStats;
}

export function buildAlbumEmbed(args: AlbumEmbedArgs): APIEmbed {
  const { summary } = args;
  const holoNote =
    summary.totalHoloCopies > 0
      ? ` (✦ Holo ×${summary.totalHoloCopies})`
      : "";
  const lines = [
    `<@${args.userId}> · Buku koleksi pribadimu siap dibuka.`,
    `📚 Kartu unik: **${summary.uniqueOwnedCards}/${summary.totalCatalogCards}** · Member: **${summary.uniqueOwnedMembers}/${summary.totalCatalogMembers}** · Total lembar: **×${summary.totalCopies}**${holoNote}`,
  ];
  if (args.poolName !== null) {
    lines.push(
      `🔖 Tab awal: ${args.poolEmoji ?? ""} **${args.poolName}** (semua pool tetap dapat diakses di dalam binder).`,
    );
  }
  lines.push(
    `🔒 **Tautan sekali pakai**: Link di bawah langsung hangus begitu dibuka satu kali (kedaluwarsa <t:${args.expiresAt}:R>). Jalankan \`/album\` kembali jika ingin membuat tautan baru.`,
  );

  return {
    title: "📖 Buku Koleksi Photocard",
    description: lines.join("\n\n"),
    color: 0xeab308,
    footer: {
      text: "Jangan bagikan tautan ini sebelum kamu membukanya sendiri.",
    },
  };
}

export function buildAlbumLinkRow(
  albumUrl: string,
): APIActionRowComponent<APIButtonComponentWithURL> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: "Buka Buku Koleksi (Sekali Pakai)",
        url: albumUrl,
      },
    ],
  };
}
