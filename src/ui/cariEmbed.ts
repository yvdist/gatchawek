 import type { APIEmbed } from "discord-api-types/v10";
 import { RARITY_LABEL, RARITY_STARS } from "../domain/rarity.js";
 import { cardImageUrl } from "./gachaEmbed.js";
 import type { CariMember } from "../db/queries/cari.js";

 export const CARI_MAX_MEMBERS = 3;

 /** Neutral archive color — deliberately NOT the rarity color gacha uses. */
 const ARCHIVE_COLOR = 0x6b7280;

 function ownerText(owners: { userId: string; qty: number; holoQty: number }[]): string {
   if (owners.length === 0) return "Belum ada yang punya";
   const parts = owners.map((o) => {
     const holo = o.holoQty > 0 ? ` (✦×${o.holoQty})` : "";
     return `<@${o.userId}> ×${o.qty + o.holoQty}${holo}`;
   });
   return `Punya: ${parts.join(", ")}`;
 }

 export const CARI_CARDS_PER_MEMBER = 3;

 export function buildCariEmbed(
   members: CariMember[],
   query: string,
   truncated: number,
   baseUrl: string,
 ): APIEmbed[] {
   const shown = members.slice(0, CARI_MAX_MEMBERS);
   const embeds = shown.flatMap((m) =>
     m.cards.slice(0, CARI_CARDS_PER_MEMBER).map((card) => {
       const name = card.photoLabel ?? `Foto ${card.photoNo}`;
       return {
         title: `🔍 ${name}`,
         description: [
           `🗂️ Arsip · ${m.memberName} (${m.groupName})`,
           `📸 ${name} · ${RARITY_STARS[card.rarity]} **${RARITY_LABEL[card.rarity] ?? card.rarity}**`,
           `No. ${card.serial} · Foto ${card.photoNo}/${card.photoTotal}`,
           `👤 ${ownerText(card.owners)}`,
         ].join("\n"),
         color: ARCHIVE_COLOR,
         thumbnail: { url: cardImageUrl(baseUrl, card.imageFile) },
         footer: { text: `Hasil cari · "${query}"` },
       } satisfies APIEmbed;
     }),
   );
   if (truncated > 0) {
     const last = embeds[embeds.length - 1];
     if (last !== undefined) {
       last.description = `${last.description}\n… +${truncated} lagi, persempit kata kunci.`;
     }
   }
   return embeds;
 }

export function buildCariEmpty(query: string): APIEmbed {
  return {
    title: `🔍 Cari: ${query}`,
    description: `Tidak ketemu "${query}". Coba nama lain.`,
  };
}
