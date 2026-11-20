/**
 * Pure planner for per-file import group segments (`(rarity) - grup - nama.jpg`).
 * Decides whether a filename group reuses a registered pool group, needs a
 * new group auto-created in the dropdown pool, falls back to the dropdown, or
 * is ambiguous. No db/hono imports (layer rule): the server in
 * src/admin/routes.ts executes the `create`/`use` decision.
 */
import { toTitleCase } from "./cardImport.js";

export interface ImportPoolGroup {
  poolId: string;
  groupId: string;
  groupName: string;
}

export interface ImportGroupCreate {
  poolId: string;
  groupId: string;
  name: string;
  badge: string;
}

export interface ImportGroupUse {
  poolId: string;
  groupId: string;
}

export type ImportGroupPlan =
  | "use-dropdown"
  | { create: ImportGroupCreate }
  | { use: ImportGroupUse }
  | "ambiguous";

/** Same normalization as the server resolver: case/whitespace-insensitive. */
function normalizeGroup(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Slug for a new group id: lowercase, non-alnum runs collapse to one dash,
 * leading/trailing dashes trimmed. Empty result means the name carries no
 * usable identifier (caller must reject instead of creating).
 */
export function slugifyGroupId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Default badge for an auto-created group: up to 6 uppercase alphanumerics
 * from the raw name. `"GRP"` when the name has none (symbols-only).
 */
export function badgeForGroupName(raw: string): string {
  const code = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return code === "" ? "GRP" : code;
}

/**
 * Plan where one filename group segment lands. `preferredPoolId` is the
 * pool behind the user's dropdown choice (never hardcoded: it flows in).
 * - null/blank segment → `"use-dropdown"` (legacy 2-segment form).
 * - exactly one match (preferred pool first, else globally unique) → `{ use }`.
 * - no match → `{ create }` in the preferred pool (slug/id derived here).
 * - several matches, or a name with no usable slug → `"ambiguous"` (reject).
 */
export function planGroupForImport(
  rawGroup: string | null,
  poolGroups: readonly ImportPoolGroup[],
  preferredPoolId: string,
): ImportGroupPlan {
  if (rawGroup === null) return "use-dropdown";
  const want = normalizeGroup(rawGroup);
  if (want === "") return "use-dropdown";
  const matches = poolGroups.filter(
    (pg) =>
      normalizeGroup(pg.groupName) === want ||
      normalizeGroup(pg.groupId) === want,
  );
  if (matches.length === 0) {
    const groupId = slugifyGroupId(rawGroup.trim());
    if (groupId === "") return "ambiguous";
    return {
      create: {
        poolId: preferredPoolId,
        groupId,
        name: toTitleCase(rawGroup),
        badge: badgeForGroupName(rawGroup),
      },
    };
  }
  const inPool = matches.filter((pg) => pg.poolId === preferredPoolId);
  const [inPoolHit] = inPool;
  if (inPool.length === 1 && inPoolHit !== undefined) {
    return { use: { poolId: inPoolHit.poolId, groupId: inPoolHit.groupId } };
  }
  if (inPool.length > 1) return "ambiguous";
  const [onlyHit] = matches;
  if (matches.length === 1 && onlyHit !== undefined) {
    return { use: { poolId: onlyHit.poolId, groupId: onlyHit.groupId } };
  }
  return "ambiguous";
}
