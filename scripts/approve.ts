import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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

function groupFileFor(pool: string, grup: string): string {
  const groupId = slugifyMemberId(grup, new Set());
  return path.join("data", "groups", pool, `komunitas-${groupId}.json`);
}

interface CommunityGroupBody {
  schemaVersion: 1;
  pool: string;
  group: { id: string; name: string; badge: string; allowSinglePhoto: boolean };
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
  const pool = options.pool ?? "pejabat";
  const pending = await readPending(root, options.messageId);
  const { submission } = pending;

  const loaded = await loadManifests(root);
  if (!loaded.poolIds.has(pool)) {
    throw new Error(`unknown pool "${pool}" (not in data/pools.json)`);
  }
  // Global member.id uniqueness (mirrors loadManifests enforcement).
  const owner = new Map<string, string>();
  for (const { file, manifest } of loaded.groups) {
    for (const member of manifest.members) owner.set(member.id, file);
  }
  const targetFile = groupFileFor(pool, submission.grup);
  const existing = await loadGroupFile(path.join(root, targetFile));
  // The base slug is the member identity. If another file owns it, reject:
  // silent "-2" suffixes would fork one person into two members.
  const memberId = slugifyMemberId(submission.nama, new Set());
  const clashOwner = owner.get(memberId);
  if (clashOwner !== undefined && clashOwner !== targetFile) {
    throw new Error(
      `member id "${memberId}" already exists in ${clashOwner}; refusing to merge across files`,
    );
  }

  let members: CommunityMemberBody[];
  let groupBody: CommunityGroupBody;
  if (existing === null) {
    groupBody = {
      schemaVersion: 1,
      pool,
      group: {
        id: `komunitas-${slugifyMemberId(submission.grup, new Set())}`,
        name: submission.grup,
        badge: "WARGA",
        allowSinglePhoto: true,
      },
      members: [],
    };
    members = groupBody.members;
  } else {
    groupBody = existing.body;
    members = groupBody.members;
  }

  let entry = members.find((m) => m.id === memberId);
  if (entry == null) {
    entry = { id: memberId, name: submission.nama, photos: [] };
    members.push(entry);
  }
  const photos = entry.photos;
  const nextPhotoNo = photos.length + 1;
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
  await mkdir(path.dirname(absTarget), { recursive: true });
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
