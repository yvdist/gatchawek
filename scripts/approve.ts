import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { POOL_GROUPS } from "./lib/submissions.js";
import { loadManifests } from "./lib/manifests.js";
import { fetchRemoteImage } from "./fetch-images.js";
import { slugifyMemberId } from "./lib/discover-commons.js";
export interface PendingSubmission {
  messageId: string;
  channelId: string;
  guildId: string;
  authorId?: string;
  messageUrl: string;
  submission: {
    nama: string;
    memberId: string;
    pool?: string;
    grup: string;
    rarity: string;
    label: string | null;
    sumber: string;
    imageUrl: string;
    authorId?: string;
  };
}

export interface ApproveOptions {
  pool?: string;
  skipFetch?: boolean;
  messageId: string;
}

export interface ApproveResult {
  groupFile: string;
  memberId: string;
  photoNo: number;
  rawPath: string | null;
}

function parseArgs(argv: string[]): ApproveOptions {
  let pool: string | undefined;
  let skipFetch = false;
  let messageId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pool" && i + 1 < argv.length) {
      pool = argv[++i];
    } else if (arg === "--skip-fetch") {
      skipFetch = true;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      messageId = arg;
    }
  }
  if (messageId === undefined) {
    throw new Error("usage: pnpm approve <messageId> [--pool <pool>] [--skip-fetch]");
  }
  return pool === undefined ? { skipFetch, messageId } : { pool, skipFetch, messageId };
}

async function readPending(root: string, messageId: string): Promise<PendingSubmission> {
  const file = path.join(root, "data", "submissions", "pending", `${messageId}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as PendingSubmission;
  } catch {
    throw new Error(`no pending submission for message ${messageId}`);
  }
}

/** Curated group file for a pool+grup pair. Pools in POOL_GROUPS resolve to
 * their fixed curated file; anything else falls back to the grup slug
 * (forward-compatible, never creates files — missing targets fail loud). */
function targetFileFor(pool: string, grup: string): string {
  const mapped = (POOL_GROUPS as Record<string, string | undefined>)[pool];
  const stem = mapped ?? slugifyMemberId(grup, new Set());
  return path.join("data", "groups", pool, `${stem}.json`);
}

interface CommunityGroupBody {
  schemaVersion: 1;
  pool: string;
  group: { id: string; name: string; badge: string; allowSinglePhoto?: boolean };
  members: CommunityMemberBody[];
}

interface CommunityMemberBody {
  id: string;
  name: string;
  photos: Record<string, unknown>[];
}

function isCommunityMemberBody(value: unknown): value is CommunityMemberBody {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "string") return false;
  if (!("name" in value) || typeof value.name !== "string") return false;
  if (!("photos" in value) || !Array.isArray(value.photos)) return false;
  return true;
}

function isCommunityGroupBody(value: unknown): value is CommunityGroupBody {
  if (typeof value !== "object" || value === null) return false;
  if (!("group" in value) || typeof value.group !== "object" || value.group === null) {
    return false;
  }
  if (!("members" in value) || !Array.isArray(value.members)) return false;
  if (!value.members.every(isCommunityMemberBody)) return false;
  return true;
}

async function loadGroupFile(absPath: string): Promise<{ body: CommunityGroupBody } | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(absPath, "utf8"));
    if (!isCommunityGroupBody(parsed)) return null;
    return { body: parsed };
  } catch {
    return null;
  }
}

export async function approve(root: string, options: ApproveOptions): Promise<ApproveResult> {
  const pending = await readPending(root, options.messageId);
  const { submission } = pending;
  // Pool comes from the submission; --pool is an operator override that must
  // agree with it. Old in-flight pendings without a pool default to pejabat.
  const submissionPool = submission.pool ?? options.pool ?? "pejabat";
  if (
    options.pool !== undefined &&
    submission.pool !== undefined &&
    options.pool !== submission.pool
  ) {
    throw new Error(
      `--pool ${options.pool} conflicts with submission pool "${submission.pool}"`,
    );
  }
  const pool = submissionPool;

  const loaded = await loadManifests(root);
  if (!loaded.poolIds.has(pool)) {
    throw new Error(`unknown pool "${pool}" (not in data/pools.json)`);
  }
  // Submission grup must match the pool's fixed curated group.
  const expectedGrup = (POOL_GROUPS as Record<string, string | undefined>)[pool];
  if (expectedGrup !== undefined && submission.grup.toLowerCase() !== expectedGrup) {
    throw new Error(
      `submission grup "${submission.grup}" does not match pool "${pool}" (must be ${expectedGrup})`,
    );
  }
  // Global member.id uniqueness (mirrors loadManifests enforcement).
  const owner = new Map<string, string>();
  for (const { file, manifest } of loaded.groups) {
    for (const member of manifest.members) owner.set(member.id, file);
  }
  const targetFile = targetFileFor(pool, submission.grup);
  // The base slug is the member identity. If another file owns it, reject:
  // silent "-2" suffixes would fork one person into two members.
  const memberId = slugifyMemberId(submission.nama, new Set());
  const clashOwner = owner.get(memberId);
  if (clashOwner !== undefined && clashOwner !== targetFile) {
    throw new Error(
      `member id "${memberId}" already exists in ${clashOwner}; refusing to merge across files`,
    );
  }

  // The target is an existing curated group file. Missing files fail loud:
  // repo groups changed, update POOL_GROUPS — never create group files here.
  const existing = await loadGroupFile(path.join(root, targetFile));
  if (existing === null) {
    throw new Error(
      `target group file ${targetFile} not found; repo groups changed, update POOL_GROUPS`,
    );
  }
  const groupBody = existing.body;
  if (groupBody.pool !== pool) {
    throw new Error(
      `target group file ${targetFile} belongs to pool "${groupBody.pool}", not "${pool}"`,
    );
  }
  const members = groupBody.members;

  let entry = members.find((m) => m.id === memberId);
  if (entry == null) {
    entry = { id: memberId, name: submission.nama, photos: [] };
    members.push(entry);
  }
  const photos = entry.photos;
  const nextPhotoNo = photos.length + 1;
  // Curated groups require ≥3 photos per member at validate time. Refuse
  // early rather than writing a file that fails `pnpm validate`.
  if (groupBody.group.allowSinglePhoto !== true && nextPhotoNo < 3) {
    throw new Error(
      `member "${memberId}" would have ${String(nextPhotoNo)} photos, group "${submission.grup}" requires at least 3 (no allowSinglePhoto); collect ${String(3 - nextPhotoNo)} more photos before approving`,
    );
  }
  const cardId = `${memberId}-${String(nextPhotoNo).padStart(2, "0")}`;
  let rawPath: string | null = null;
  if (!options.skipFetch) {
    const rawDir = path.join(root, "assets", "raw");
    await mkdir(rawDir, { recursive: true });
    const fetched = await fetchRemoteImage(cardId, submission.imageUrl, rawDir);
    if (typeof fetched !== "string") {
      throw new Error(
        `image gate failed for ${cardId}: ${fetched.reason} (stays pending; fix and retry, or --skip-fetch with a manual file)`,
      );
    }
    rawPath = fetched;
  }

  // --skip-fetch fallback: operator drops the real file at
  // assets/raw/<cardId>.<ext> (downloaded manually); the manifest keeps
  // the original CDN imageUrl for provenance.
  if (options.skipFetch) {
    const rawDir = path.join(root, "assets", "raw");
    try {
      const files = await readdir(rawDir);
      const match = files.find((f) => f.startsWith(`${cardId}.`));
      if (match === undefined) {
        throw new Error(
          `no manual file for ${cardId} in assets/raw/ (expected assets/raw/${cardId}.<ext>)`,
        );
      }
      rawPath = path.join(rawDir, match);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("no manual file")) throw err;
      throw new Error(`no manual file for ${cardId} in assets/raw/`, { cause: err });
    }
  }

  photos.push({
    photoNo: nextPhotoNo,
    rarity: submission.rarity,
    imageUrl: submission.imageUrl,
    sourcePageUrl: submission.sumber,
    license: null,
    author: null,
    ...(submission.label !== null ? { label: submission.label } : {}),
  });

  const absTarget = path.join(root, targetFile);
  await writeFile(absTarget, `${JSON.stringify(groupBody, null, 2)}\n`);

  // Move pending → approved.
  const approvedDir = path.join(root, "data", "submissions", "approved");
  await mkdir(approvedDir, { recursive: true });
  await writeFile(
    path.join(approvedDir, `${options.messageId}.json`),
    JSON.stringify({ ...pending, approved: { memberId, photoNo: nextPhotoNo, pool, targetFile, rawPath } }, null, 2),
  );
  await unlink(path.join(root, "data", "submissions", "pending", `${options.messageId}.json`)).catch(
    () => {},
  );

  return { groupFile: targetFile, memberId, photoNo: nextPhotoNo, rawPath };
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const options = parseArgs(process.argv.slice(2));
  const result = await approve(root, options);
  console.log(
    `approved ${result.memberId} photo #${String(result.photoNo)} → ${result.groupFile}${result.rawPath === null ? " (no raw file)" : ""}`,
  );
}
