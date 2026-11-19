import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
} from "discord-api-types/v10";
import { koleksiPageCustomId } from "../domain/koleksi.js";
import type {
  KoleksiFilters,
  OwnedMemberRow,
} from "../db/queries/koleksi.js";
export function formatOwnedPhotos(
  photos: { photoNo: number; quantity: number }[],
): string {
  if (photos.length === 0) return "—";
  const sorted = [...photos].sort((a, b) => a.photoNo - b.photoNo);
  return sorted
    .map((p) => (p.quantity >= 2 ? `#${p.photoNo}×${p.quantity}` : `#${p.photoNo}`))
    .join(" ");
}

export interface KoleksiEmbedArgs {
  viewerId: string;
  poolName: string;
  poolEmoji: string;
  groupLabel: string;
  members: OwnedMemberRow[];
  page: number;
  totalPages: number;
  groupOwned: number;
  groupTotal: number;
  filters: KoleksiFilters;
}

export function buildKoleksiEmbed(args: KoleksiEmbedArgs): APIEmbed {
  const lines = args.members.map(
    (m) =>
      `**${m.memberName}** — ${m.ownedPhotos}/${m.photoTotal} foto: ${formatOwnedPhotos(m.photos)}`,
  );
  return {
    title: `📚 Koleksi ${args.poolEmoji} ${args.poolName}`,
    description: `<@${args.viewerId}>\n\n${lines.join("\n")}`,
    footer: {
      text: `Koleksi ${args.groupLabel}: ${args.groupOwned}/${args.groupTotal} member · Hal ${args.page + 1}/${args.totalPages}`,
    },
  };
}

export function koleksiNavRow(
  ownerId: string,
  poolId: string,
  groupId: string,
  page: number,
  totalPages: number,
): APIActionRowComponent<APIButtonComponentWithCustomId> {
  const atStart = totalPages <= 1 || page <= 0;
  const atEnd = totalPages <= 1 || page >= totalPages - 1;
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "◀ Prev",
        custom_id: koleksiPageCustomId(
          ownerId,
          poolId,
          groupId,
          Math.max(0, page - 1),
        ),
        disabled: atStart,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "Next ▶",
        custom_id: koleksiPageCustomId(
          ownerId,
          poolId,
          groupId,
          Math.min(Math.max(0, totalPages - 1), page + 1),
        ),
        disabled: atEnd,
      },
    ],
  };
}
