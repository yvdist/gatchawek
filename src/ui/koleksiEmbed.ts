import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
  type APISelectMenuOption,
  type APIStringSelectComponent,
} from "discord-api-types/v10";
import {
  koleksiCardSelectCustomId,
  koleksiPageCustomId,
  koleksiPamerCustomId,
} from "../domain/koleksi.js";
import { cardDisplayName } from "../domain/gacha.js";
import {
  RARITY_COLOR,
  RARITY_LABEL,
  RARITY_STARS,
  type RarityKey,
} from "../domain/rarity.js";
import type {
  KoleksiFilters,
  OwnedMemberRow,
} from "../db/queries/koleksi.js";
import type { ShowcaseCard } from "../db/queries/pamer.js";

/** Discord caps a select menu at 25 options. */
export const KOLEKSI_SELECT_CHUNK = 25;

/** 4 select rows + 1 nav row = Discord's 5-row limit. */
export const KOLEKSI_SELECT_MAX_CARDS = 100;

export function formatOwnedPhotos(
  photos: {
    photoNo: number;
    quantity: number;
    rarity: RarityKey;
    photoLabel?: string | null;
  }[],
): string {
  if (photos.length === 0) return "—";
  const sorted = [...photos].sort((a, b) => a.photoNo - b.photoNo);
  return sorted
    .map((p) => {
      const qty = p.quantity >= 2 ? `×${p.quantity}` : "";
      const base = p.photoLabel ? `Foto ${p.photoNo} · ${p.photoLabel}` : `#${p.photoNo}`;
      return `${base} ${RARITY_STARS[p.rarity]}${qty}`;
    })
    .join(" ");
}

/** Owned photos in query order (members in page order, photos by photoNo). */
function flattenOwnedPhotos(
  members: OwnedMemberRow[],
): { member: OwnedMemberRow; cardId: string; photoNo: number; rarity: RarityKey; photoLabel: string | null }[] {
  const flat: {
    member: OwnedMemberRow;
    cardId: string;
    photoNo: number;
    rarity: RarityKey;
    photoLabel: string | null;
  }[] = [];
  for (const member of members) {
    for (const photo of member.photos) {
      flat.push({
        member,
        cardId: photo.cardId,
        photoNo: photo.photoNo,
        rarity: photo.rarity,
        photoLabel: photo.photoLabel,
      });
    }
  }
  return flat;
}

/** Number of page cards trimmed by the 100-option cap (0 = all reachable). */
export function koleksiCardPickerOverflow(members: OwnedMemberRow[]): number {
  return Math.max(0, flattenOwnedPhotos(members).length - KOLEKSI_SELECT_MAX_CARDS);
}

/**
 * Card dropdowns for the current page, one action row per 25 cards.
 * Callers append the nav row after these (Discord allows 5 rows total).
 */
export function koleksiCardSelectRows(
  ownerId: string,
  members: OwnedMemberRow[],
): APIActionRowComponent<APIStringSelectComponent>[] {
  const flat = flattenOwnedPhotos(members).slice(0, KOLEKSI_SELECT_MAX_CARDS);
  const rows: APIActionRowComponent<APIStringSelectComponent>[] = [];
  for (let start = 0; start < flat.length; start += KOLEKSI_SELECT_CHUNK) {
    const chunk = flat.slice(start, start + KOLEKSI_SELECT_CHUNK);
    const options: APISelectMenuOption[] = chunk.map((entry) => ({
      label:
        `${RARITY_STARS[entry.rarity]} ${cardDisplayName(entry.photoLabel, entry.member.memberName)} · Foto ${entry.photoNo}`.slice(
          0,
          100,
        ),
      description: `${entry.member.groupBadge} · ${RARITY_LABEL[entry.rarity]}`.slice(
        0,
        100,
      ),
      value: entry.cardId,
    }));
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: koleksiCardSelectCustomId(
            ownerId,
            Math.floor(start / KOLEKSI_SELECT_CHUNK),
          ),
          placeholder: `Pilih kartu di halaman ini (${chunk.length})`,
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    });
  }
  return rows;
}

export function koleksiCardPamerRow(
  ownerId: string,
  cardId: string,
): APIActionRowComponent<APIButtonComponentWithCustomId> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        label: "🖼️ Pamer kartu ini",
        custom_id: koleksiPamerCustomId(ownerId, cardId),
      },
    ],
  };
}

export function buildKoleksiCardEmbed(args: {
  userId: string;
  card: ShowcaseCard;
  imageUrl: string;
}): APIEmbed {
  const { card } = args;
  return {
    title: `🎴 ${cardDisplayName(card.photoLabel, card.memberName)} (${card.groupName})`,
    description:
      `<@${args.userId}> · ${RARITY_STARS[card.rarity]} **${RARITY_LABEL[card.rarity]}**\n` +
      `${card.poolEmoji} ${card.poolName} · ${card.groupName} · 📸 Foto ${card.photoNo}/${card.photoTotal}\n` +
      `💎 No. ${card.serial} · Punya ×${card.quantity}`,
    color: RARITY_COLOR[card.rarity],
    image: { url: args.imageUrl },
    footer: { text: `💎 ${card.poolName} · ${card.groupName}` },
  };
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
