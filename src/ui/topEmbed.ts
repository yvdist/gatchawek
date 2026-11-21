import type { APIEmbed } from "discord-api-types/v10";
import type {
  TopCollector,
  TopHoloOwner,
  TopLevelPlayer,
} from "../db/queries/top.js";

const MEDAL = ["🥇", "🥈", "🥉", "4.", "5."] as const;

export function buildTopEmbed(
  collectors: TopCollector[],
  holoOwners: TopHoloOwner[],
  topLevels: TopLevelPlayer[] = [],
): APIEmbed {
  const lines: string[] = [];
  lines.push("**Level & EXP teratas**");
  if (topLevels.length === 0) {
    lines.push("_Belum ada EXP._");
  } else {
    for (const p of topLevels) {
      const medal = MEDAL[p.rank - 1] ?? `${p.rank}.`;
      lines.push(`${medal} <@${p.userId}> — Lv.${p.level} (${p.exp} EXP)`);
    }
  }
  lines.push("");
  lines.push("**Kolektor teratas**");
  if (collectors.length === 0) {
    lines.push("_Belum ada kolektor._");
  } else {
    for (const c of collectors) {
      const medal = MEDAL[c.rank - 1] ?? `${c.rank}.`;
      lines.push(
        `${medal} <@${c.userId}> — ${c.distinctMembers} member (${c.poolName})`,
      );
    }
  }
  lines.push("");
  lines.push("**Pemilik holo teratas**");
  if (holoOwners.length === 0) {
    lines.push("_Belum ada holo._");
  } else {
    for (const h of holoOwners) {
      const medal = MEDAL[h.rank - 1] ?? `${h.rank}.`;
      lines.push(`${medal} <@${h.userId}> — ✦×${h.holoTotal}`);
    }
  }
  return {
    title: "🏆 Papan Peringkat",
    description: lines.join("\n").slice(0, 4000),
  };
}
