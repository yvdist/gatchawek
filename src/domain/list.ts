/** Pure helpers for `/list` pagination, custom IDs, and owner-gated buttons. */

export const LIST_PAGE_SIZE = 15;

/** Every non-space character → `*`, spaces kept (length stays readable). */
export function censorName(name: string): string {
  return name.replace(/[^\s]/gu, "*");
}

export function clampListPage(page: number, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 0;
  if (!Number.isFinite(page)) return 0;
  const p = Math.floor(page);
  if (p < 0) return 0;
  return Math.min(p, Math.floor(totalPages) - 1);
}

export function isListButtonOwner(
  clickerId: string | null,
  ownerId: string,
): boolean {
  return clickerId !== null && clickerId === ownerId;
}

export interface ListPageTarget {
  ownerId: string;
  poolKey: string;
  groupKey: string;
  page: number;
}

const PAGE_SEGMENT = /^\d{1,6}$/;

/**
 * Parses `list:p:<ownerId>:<poolKey>:<groupKey>:<page>`.
 * `"*"` in poolKey/groupKey means unfiltered. Returns null on any other shape.
 */
export function parseListPageCustomId(customId: string): ListPageTarget | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  const [ns, action, ownerId, poolKey, groupKey, pageRaw] = parts;
  if (ns !== "list" || action !== "p") return null;
  if (
    ownerId === undefined ||
    ownerId === "" ||
    poolKey === undefined ||
    poolKey === "" ||
    groupKey === undefined ||
    groupKey === "" ||
    pageRaw === undefined ||
    !PAGE_SEGMENT.test(pageRaw)
  ) {
    return null;
  }
  return { ownerId, poolKey, groupKey, page: Number(pageRaw) };
}

export function listPageCustomId(
  ownerId: string,
  poolKey: string,
  groupKey: string,
  page: number,
): string {
  return `list:p:${ownerId}:${poolKey}:${groupKey}:${page}`;
}
