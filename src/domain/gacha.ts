export type PullKind = "new-member" | "new-photo" | "duplicate";

export function pullKind(hasCard: boolean, memberOwned: boolean): PullKind {
  if (!hasCard && !memberOwned) return "new-member";
  if (!hasCard) return "new-photo";
  return "duplicate";
}

export function pullLabel(kind: PullKind, quantity: number): string {
  switch (kind) {
    case "new-member":
      return "✨ Kartu baru!";
    case "new-photo":
      return "🆕 Foto baru!";
    case "duplicate":
      return `🔁 Duplikat ×${quantity}`;
  }
}

export interface GachaAgainTarget {
  poolId: string;
  ownerId: string;
}

/** Parses `gacha:again:<poolId>:<ownerId>`; null on any other shape. */
export function parseGachaAgainCustomId(
  customId: string,
): GachaAgainTarget | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  const [ns, action, poolId, ownerId] = parts;
  if (ns !== "gacha" || action !== "again") return null;
  if (
    poolId === undefined ||
    ownerId === undefined ||
    poolId === "" ||
    ownerId === ""
  ) {
    return null;
  }
  return { poolId, ownerId };
}
