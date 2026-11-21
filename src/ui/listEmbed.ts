import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
} from "discord-api-types/v10";
import { isHiddenRarity, RARITY_STARS } from "../domain/rarity.js";
import { censorName, listPageCustomId } from "../domain/list.js";
import type { ListCardRow, ListFilters } from "../db/queries/list.js";

export interface ListEmbedArgs {
  viewerId: string;
  cards: ListCardRow[];
  totalCards: number;
  page: number;
  totalPages: number;
  poolName: string | null;
  poolEmoji: string | null;
  groupName: string | null;
  groupBadge: string | null;
  filters: ListFilters;
}

function buildTitle(args: ListEmbedArgs): string {
  if (args.groupName !== null) {
    const badge = args.groupBadge !== null && args.groupBadge !== "" ? `${args.groupBadge} ` : "";
    const poolPart =
      args.poolName !== null
        ? ` (${args.poolEmoji ?? ""} ${args.poolName})`.replace("( ", "(")
        : "";
    return `📋 Daftar Kartu · ${badge}${args.groupName}${poolPart}`;
  }
  if (args.poolName !== null) {
    const emoji = args.poolEmoji !== null && args.poolEmoji !== "" ? `${args.poolEmoji} ` : "";
    return `📋 Daftar Kartu · ${emoji}${args.poolName}`;
  }
  return "📋 Daftar Kartu · Semua Pool";
}

function formatCardLine(card: ListCardRow, filters: ListFilters): string {
  const stars = RARITY_STARS[card.rarity];
  const holo = card.holoEnabled ? " ✦" : "";
  // Holo/secret names are censored; backticks keep Discord from eating the stars.
  const hidden = isHiddenRarity(card.rarity);
  const name = hidden ? `\`${censorName(card.memberName)}\`` : `**${card.memberName}**`;
  const label =
    card.photoLabel !== null && card.photoLabel !== ""
      ? ` · ${hidden ? `\`${censorName(card.photoLabel)}\`` : `*${card.photoLabel}*`}`
      : "";
  const scopePrefix =
    filters.poolId === null
      ? `${card.poolEmoji} ${card.groupBadge} `
      : filters.groupId === null
        ? `${card.groupBadge} `
        : "";
  return `${scopePrefix}${stars}${holo} ${name} · Foto ${card.photoNo}${label} \`#${card.serial}\``;
}

export function buildListEmbed(args: ListEmbedArgs): APIEmbed {
  const lines = args.cards.map((c) => formatCardLine(c, args.filters));
  const scopeParts: string[] = [];
  if (args.poolName !== null) scopeParts.push(args.poolName);
  if (args.groupName !== null) scopeParts.push(args.groupName);
  const scopeFooter = scopeParts.length > 0 ? `${scopeParts.join(" · ")} · ` : "";

  return {
    title: buildTitle(args),
    description: `<@${args.viewerId}>\n\n${lines.join("\n")}`,
    footer: {
      text: `${scopeFooter}Total ${args.totalCards} kartu · Hal ${args.page + 1}/${args.totalPages}`,
    },
  };
}

export function listNavRow(
  ownerId: string,
  poolKey: string,
  groupKey: string,
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
        custom_id: listPageCustomId(
          ownerId,
          poolKey,
          groupKey,
          Math.max(0, page - 1),
        ),
        disabled: atStart,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "Next ▶",
        custom_id: listPageCustomId(
          ownerId,
          poolKey,
          groupKey,
          Math.min(Math.max(0, totalPages - 1), page + 1),
        ),
        disabled: atEnd,
      },
    ],
  };
}
