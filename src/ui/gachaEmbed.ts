import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
} from "discord-api-types/v10";
import { cardDisplayName, type PullKind } from "../domain/gacha.js";
import {
  RARITY_COLOR,
  RARITY_LABEL,
  RARITY_STARS,
  type RarityKey,
} from "../domain/rarity.js";
import type { PoolStatusRow } from "../db/queries/gacha.js";

export function cardImageUrl(base: string, imageFile: string): string {
  if (imageFile.startsWith("https://") || imageFile.startsWith("http://")) {
    return imageFile;
  }
  return `https://${base}/cards/${imageFile}`;
}

export interface PullEmbedArgs {
  poolName: string;
  poolEmoji: string;
  memberName: string;
  photoLabel: string | null;
  groupName: string;
  fullName: string | null;
  photoNo: number;
  photoTotal: number;
  rarity: RarityKey;
  kind: PullKind;
  isHolo: boolean;
  isFirstClaim: boolean;
  wishHit?: boolean;
  quantity: number;
  userId: string;
  groupOwned: number;
  groupTotal: number;
  staminaLeft: number;
  staminaMax: number;
  imageUrl: string;
}

function describePull(kind: PullKind, quantity: number, isHolo = false): string {
  const prefix = isHolo ? "✦ HOLO " : "";
  switch (kind) {
    case "new-member":
      return `${prefix}✨ Kartu baru!`;
    case "new-photo":
      return `${prefix}🆕 Foto baru!`;
    case "duplicate":
      return `${prefix}🔁 Duplikat ×${quantity}`;
  }
}

export function buildPullEmbed(args: PullEmbedArgs): APIEmbed {
  const stars = RARITY_STARS[args.rarity];
  const label = RARITY_LABEL[args.rarity];
  const displayName = cardDisplayName(args.photoLabel, args.memberName);
  // Labeled photos show their own name; unlabeled keep the legacy full line.
  const nameLine = args.photoLabel ?? args.fullName ?? args.memberName;
  const description = [
    `<@${args.userId}> dapet photocard ${args.poolName} ${args.poolEmoji} ${stars} **${label}**!`,
    `${args.groupName} · ${nameLine} · 📸 Foto ${args.photoNo}/${args.photoTotal}`,
    describePull(args.kind, args.quantity, args.isHolo),
    `📚 Koleksi ${args.groupName}: **${args.groupOwned}/${args.groupTotal}**`,
  ];
  if (args.isHolo) description.push("✨ Holographic!");
  if (args.wishHit === true)
    description.push("🌠 Wish terkabul! Kartu ini dihapus dari wishlist.");
  if (args.isFirstClaim)
    description.push(`🌍 Orang pertama yang punya ${args.memberName}!`);
  return {
    title: `${args.isHolo ? "✦ " : ""}🎴 ${displayName} (${args.groupName})`,
    description: description.join("\n"),
    color: args.isHolo ? 0xffd700 : RARITY_COLOR[args.rarity],
    image: { url: args.imageUrl },
    footer: { text: `Sisa tarik: ${args.staminaLeft}/${args.staminaMax}` },
  };
}

export function gachaAgainCustomId(poolId: string, ownerId: string): string {
  return `gacha:again:${poolId}:${ownerId}`;
}

export function againButton(
  poolId: string,
  ownerId: string,
): APIActionRowComponent<APIButtonComponentWithCustomId> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        label: "🎲 Tarik Lagi",
        custom_id: gachaAgainCustomId(poolId, ownerId),
      },
    ],
  };
}

export function buildStatusEmbed(
  rows: PoolStatusRow[],
  userId: string,
): APIEmbed {
  const lines = rows.map((row) => {
    const tick =
      row.nextAt === null
        ? "penuh"
        : `nambah lagi <t:${row.nextAt}:R>`;
    const reset =
      row.resetDeniedReason === "full"
        ? "tidak perlu (masih penuh)"
        : row.resetReady
          ? "siap dipakai"
          : `bisa lagi <t:${row.resetReadyAt}:R>`;
    return [
      `${row.pool.emoji} **${row.pool.name}**`,
      `🎲 Sisa tarik (/gacha pool:${row.pool.id}): ${row.stamina}/${row.max}, ${tick}`,
      `🔄 Reset: ${reset}`,
      `📚 Koleksi: ${row.owned}/${row.total} member`,
    ].join("\n");
  });
  return {
    title: "📊 Status",
    description: `<@${userId}>\n\n${lines.join("\n\n")}`,
    color: 0x38bdf8,
  };
}

export function resetResultText(
  poolEmoji: string,
  poolName: string,
  staminaMax: number,
  outcome:
    | { status: "ok" }
    | { status: "denied"; reason: "full" | "cooldown"; readyAt: number },
): string {
  if (outcome.status === "ok") {
    return `${poolEmoji} **${poolName}** di-reset! Stamina penuh: ${staminaMax}/${staminaMax}.`;
  }
  if (outcome.reason === "full") {
    return `${poolEmoji} **${poolName}** masih penuh (${staminaMax}/${staminaMax}). Reset tidak dipakai.`;
  }
  return `${poolEmoji} **${poolName}** masih cooldown. Bisa lagi <t:${outcome.readyAt}:R>.`;
}
