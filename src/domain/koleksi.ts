/** Pure helpers for `/koleksi` pagination and owner-gated buttons. */

export const PAGE_SIZE = 8;

export interface KoleksiPage {
  totalPages: number;
  page: number;
}

export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 0;
  if (!Number.isFinite(page)) return 0;
  const p = Math.floor(page);
  if (p < 0) return 0;
  return Math.min(p, Math.floor(totalPages) - 1);
}

export function ownerGate(
  clickerId: string | null,
  ownerId: string,
): boolean {
  return clickerId !== null && clickerId === ownerId;
}

export interface KoleksiPageTarget {
  ownerId: string;
  poolId: string;
  groupId: string;
  page: number;
}

const PAGE_SEGMENT = /^\d{1,3}$/;

/**
 * Parses `koleksi:p:<ownerId>:<poolId>:<groupId>:<page>`.
 * `groupId === "*"` means all groups in the pool. Null on any other shape.
 */
export function parseKoleksiPageCustomId(
  customId: string,
): KoleksiPageTarget | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  const [ns, action, ownerId, poolId, groupId, pageRaw] = parts;
  if (ns !== "koleksi" || action !== "p") return null;
  if (
    ownerId === undefined ||
    ownerId === "" ||
    poolId === undefined ||
    poolId === "" ||
    groupId === undefined ||
    groupId === "" ||
    pageRaw === undefined ||
    !PAGE_SEGMENT.test(pageRaw)
  ) {
    return null;
  }
  return { ownerId, poolId, groupId, page: Number(pageRaw) };
}

export function koleksiPageCustomId(
  ownerId: string,
  poolId: string,
  groupId: string,
  page: number,
): string {
  return `koleksi:p:${ownerId}:${poolId}:${groupId}:${page}`;
}
