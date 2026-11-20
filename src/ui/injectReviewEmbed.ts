import type { APIEmbed } from "discord-api-types/v10";
import type { QueueRow } from "../db/queries/inject.js";

export interface InjectReviewEmbedArgs {
  row: QueueRow;
  pendingCount: number;
}

export function injectCustomId(action: "ok" | "no", messageId: string): string {
  return `inject:${action}:${messageId}`;
}

export function parseInjectCustomId(customId: string): {
  action: "ok" | "no";
  messageId: string;
} | null {
  const [ns, action, messageId] = customId.split(":");
  if (ns !== "inject") return null;
  if (action !== "ok" && action !== "no") return null;
  if (messageId === undefined || messageId === "") return null;
  return { action, messageId };
}

export function buildInjectReviewEmbed(args: InjectReviewEmbedArgs): APIEmbed {
  const r = args.row;
  const lines = [
    `**${r.nama ?? "(tanpa nama)"}** (${r.pool ?? "?"} / ${r.grup ?? "?"})`,
    `Rarity: ${r.rarity ?? "?"}${r.label !== null && r.label !== "" ? ` · Label: ${r.label}` : ""}`,
    `Sumber: ${r.sumber ?? r.messageUrl}`,
    `Pesan asli: ${r.messageUrl}`,
    ``,
    `Antrean: ${String(args.pendingCount)} pending (ini yang tertua).`,
  ];
  const embed: APIEmbed = {
    title: "📥 Review Inject",
    description: lines.join("\n"),
  };
  if (r.imageUrl !== null && r.imageUrl !== "") {
    embed.image = { url: r.imageUrl };
  }
  return embed;
}

export function injectReviewButtons(messageId: string): [
  { type: 2; style: 3; label: string; custom_id: string },
  { type: 2; style: 4; label: string; custom_id: string },
] {
  return [
    { type: 2, style: 3, label: "✅ Approve", custom_id: injectCustomId("ok", messageId) },
    { type: 2, style: 4, label: "❌ Reject", custom_id: injectCustomId("no", messageId) },
  ];
}
