import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { z } from "zod";
import {
  groupManifestSchema,
  type PhotoManifest,
} from "../shared/manifest.schema.js";
import {
  assignRarities,
  CACHE_DIR,
  commonsCategoryUrl,
  esc,
  extractCommonsCategory,
  extractWikibaseItem,
  fetchJsonCached,
  fetchSetnegPhoto,
  MAX_FILES_PER_MEMBER,
  MAX_PHOTOS_PER_MEMBER,
  MIN_PHOTOS_PER_MEMBER,
  parseCommonsResponse,
  rankPhotos,
  scorePhoto,
  selectEligible,
  SETNEG_AUTHOR,
  SETNEG_LICENSE,
  SETNEG_SOURCE_PAGE,
  slugifyMemberId,
  wikidataClaimsUrl,
  wikipediaPagePropsUrl,
  type EligiblePhoto,
} from "./lib/discover-commons.js";

const wikiSourceSchema = z.object({
  wikipedia: z.object({
    lang: z.string().min(1),
    title: z.string().min(1),
  }),
});
const categorySourceSchema = z.object({
  commonsCategory: z.string().min(1),
});
const setnegSourceSchema = z.object({
  setneg: z.object({
    photoUrl: z.string().refine((v) => v.startsWith("https://"), {
      message: "setneg.photoUrl must be an https URL",
    }),
    jabatan: z.string().min(1),
  }),
});
const rosterEntryBaseSchema = z.object({
  name: z.string().min(1),
  fullName: z.string().min(1),
  wikipediaTitleFallback: z.string().min(1).optional(),
  commonsCategoryFallback: z.string().min(1).optional(),
});
const rosterSchema = z.object({
  pool: z.string().min(1),
  group: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    badge: z.string().min(1),
  }),
  roster: z.array(
    z
      .union([wikiSourceSchema, categorySourceSchema, setnegSourceSchema])
      .and(rosterEntryBaseSchema),
  ).refine(
    (entries) =>
      entries.every((e) => {
        const sources = [
          "wikipedia" in e && e.wikipedia !== undefined,
          "commonsCategory" in e && e.commonsCategory !== undefined,
          "setneg" in e && e.setneg !== undefined,
        ].filter(Boolean).length;
        return sources === 1;
      }),
    { message: "entry needs exactly one of wikipedia|commonsCategory|setneg" },
  ),
});

type Roster = z.infer<typeof rosterSchema>;

export interface KeptMember {
  memberId: string;
  displayName: string;
  fullName: string;
  photos: Array<EligiblePhoto & { photoNo: number; rarity: PhotoManifest["rarity"] }>;
  skipped: number;
}

export interface DroppedMember {
  name: string;
  reason: string;
}

export interface DiscoverSummary {
  kept: KeptMember[];
  dropped: DroppedMember[];
  manifestPath: string;
  reportPath: string;
}

async function resolveCommonsCategory(
  entry: Roster["roster"][number],
  direct: string | undefined,
  cacheDir: string,
): Promise<string> {
  if (direct !== undefined) {
    console.log(`  category override: ${direct}`);
    return direct;
  }
  if ("wikipedia" in entry && entry.wikipedia !== undefined) {
    const wiki = entry.wikipedia;
    const pageData = await fetchJsonCached(
      wikipediaPagePropsUrl(wiki.lang, wiki.title),
      cacheDir,
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "unknown-fetch-error";
      if (msg.startsWith("wikipedia-") || msg.startsWith("api-shape-changed:")) {
        throw err;
      }
      throw new Error(`wikipedia-fetch-failed:${msg}`);
    });
    const qid = extractWikibaseItem(pageData);
    const claimsData = await fetchJsonCached(wikidataClaimsUrl(qid), cacheDir).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : "unknown-fetch-error";
        if (msg.startsWith("wikidata-") || msg.startsWith("api-shape-changed:")) {
          throw err;
        }
        throw new Error(`wikidata-fetch-failed:${msg}`);
      },
    );
    return extractCommonsCategory(claimsData);
  }
  throw new Error("roster-entry-missing-source");
}

async function discoverCommonsCategory(
  category: string,
  cacheDir: string,
): Promise<{ eligible: EligiblePhoto[]; skippedCount: number; seen: number }> {
  const eligible: EligiblePhoto[] = [];
  let skippedCount = 0;
  let cont: string | null = null;
  let seen = 0;
  for (;;) {
    const data = await fetchJsonCached(
      commonsCategoryUrl(category, cont),
      cacheDir,
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "unknown-fetch-error";
      if (msg === "maxlag retries exhausted: commons.wikimedia.org/w/api.php") {
        throw new Error("commons-maxlag-exhausted");
      }
      if (msg.startsWith("api-shape-changed:")) throw err;
      throw new Error(`commons-fetch-failed:${msg}`);
    });
    const page = parseCommonsResponse(data);
    const { eligible: batch, skipped } = selectEligible(page.files);
    for (const photo of batch) {
      console.log(
        `  eligible: ${photo.title} (${photo.width}x${photo.height}, ${photo.license})`,
      );
    }
    for (const skip of skipped) {
      console.log(`  skipped: ${skip.title} (${skip.reason})`);
    }
    eligible.push(...batch);
    skippedCount += skipped.length;
    seen += page.files.length;
    if (eligible.length >= MAX_PHOTOS_PER_MEMBER && page.next !== null) {
      // Enough candidates already ranked later; still need full page count? No:
      // stop early only when we already hold more than enough. Otherwise keep paging.
    }
    if (page.next === null || seen >= MAX_FILES_PER_MEMBER) break;
    cont = page.next;
    if (eligible.length >= MAX_PHOTOS_PER_MEMBER * 3) break;
  }
  return { eligible, skippedCount, seen };
}

async function discoverMember(
  entry: Roster["roster"][number],
  cacheDir: string,
): Promise<{ eligible: EligiblePhoto[]; skippedCount: number }> {
  if ("setneg" in entry && entry.setneg !== undefined) {
    const setnegDims = await fetchSetnegPhoto(entry.setneg.photoUrl);
    console.log(
      `  eligible: ${entry.fullName} (Setneg ${setnegDims.width}x${setnegDims.height}, ${SETNEG_LICENSE})`,
    );
    const setnegPhoto: EligiblePhoto = {
      title: entry.fullName,
      imageUrl: entry.setneg.photoUrl,
      sourcePageUrl: SETNEG_SOURCE_PAGE,
      license: SETNEG_LICENSE,
      author: SETNEG_AUTHOR,
      width: setnegDims.width,
      height: setnegDims.height,
    };
    const direct =
      "commonsCategoryFallback" in entry ? entry.commonsCategoryFallback : undefined;
    if (direct === undefined && entry.wikipediaTitleFallback === undefined) {
      return { eligible: [setnegPhoto], skippedCount: 0 };
    }
    let category: string | null = null;
    try {
      if (direct !== undefined) {
        category = direct;
        console.log(`  category override: ${category}`);
      } else if (entry.wikipediaTitleFallback !== undefined) {
        const pageData = await fetchJsonCached(
          wikipediaPagePropsUrl("id", entry.wikipediaTitleFallback),
          cacheDir,
        );
        category = extractCommonsCategory(
          await fetchJsonCached(
            wikidataClaimsUrl(extractWikibaseItem(pageData)),
            cacheDir,
          ),
        );
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`  fallback Commons unavailable: ${reason}`);
    }
    if (category === null) return { eligible: [setnegPhoto], skippedCount: 0 };
    const commons = await discoverCommonsCategory(category, cacheDir);
    const rest = rankPhotos(
      commons.eligible.filter((p) => p.imageUrl !== setnegPhoto.imageUrl),
    );
    // Setneg portrait always rank-1: one point above the max Commons score
    // (a literal PORTRAIT_BONUS+1 would lose to large Commons portraits,
    // which also carry PORTRAIT_BONUS — intent here is absolute rank-1).
    const maxCommonsScore = Math.max(
      0,
      ...commons.eligible.map((p) => scorePhoto(p.width, p.height)),
    );
    const ranked: EligiblePhoto = {
      ...setnegPhoto,
      scoreOverride: maxCommonsScore + 1,
    };
    const eligible = [ranked, ...rest].slice(0, MAX_PHOTOS_PER_MEMBER);
    if (eligible.length < MIN_PHOTOS_PER_MEMBER) {
      throw new Error(
        `fewer-than-3-eligible-photos (n=${eligible.length})`,
      );
    }
    return { eligible, skippedCount: commons.skippedCount };
  }
  const direct =
    "commonsCategory" in entry ? entry.commonsCategory : undefined;
  const category = await resolveCommonsCategory(entry, direct, cacheDir);
  const { eligible, skippedCount, seen } = await discoverCommonsCategory(
    category,
    cacheDir,
  );
  if (seen === 0) throw new Error("commons-no-category-files");
  if (eligible.length < MIN_PHOTOS_PER_MEMBER) {
    throw new Error(
      `fewer-than-3-eligible-photos (n=${eligible.length})`,
    );
  }
  return { eligible, skippedCount };
}

function buildReport(
  groupName: string,
  kept: KeptMember[],
  dropped: DroppedMember[],
): string {
  const rows = kept
    .map(
      (m) =>
        `      <tr><td>${esc(m.displayName)}</td><td>${esc(m.memberId)}</td><td>${m.photos.length}</td></tr>`,
    )
    .join("\n");
  const dropRows = dropped
    .map(
      (d) => `      <tr><td>${esc(d.name)}</td><td>${esc(d.reason)}</td></tr>`,
    )
    .join("\n");
  const sections = kept
    .map(
      (m) => `    <section>
      <h2>${esc(m.displayName)} (${esc(m.memberId)}) — ${m.photos.length} photos</h2>
${m.photos
  .map(
    (p) => `      <figure>
        <img src="${esc(p.imageUrl)}" width="300" loading="lazy" alt="${esc(p.title)}">
        <figcaption>${esc(p.title)} — ${esc(p.license)}${p.author === null ? "" : ` — ${esc(p.author)}`} [${esc(p.rarity)}] (${p.sourcePageUrl === SETNEG_SOURCE_PAGE ? "Setneg" : "Commons"})</figcaption>
      </figure>`,
  )
  .join("\n")}
    </section>`,
    )
    .join("\n");
  const dropSections =
    dropped.length === 0
      ? ""
      : `    <section>
      <h2>Dropped (${dropped.length})</h2>
      <table>
        <tr><th>Name</th><th>Reason</th></tr>
${dropRows}
      </table>
    </section>`;
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Discover: ${esc(groupName)}</title>
<style>
body { font-family: sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
table { border-collapse: collapse; margin-bottom: 2rem; }
td, th { border: 1px solid #ccc; padding: 0.4rem 0.8rem; text-align: left; }
figure { display: inline-block; vertical-align: top; margin: 0 1rem 1rem 0; max-width: 320px; }
figcaption { font-size: 0.85rem; margin-top: 0.3rem; }
</style>
</head>
<body>
  <h1>Discover: ${esc(groupName)}</h1>
  <h2>Kept (${kept.length})</h2>
  <table>
    <tr><th>Member</th><th>ID</th><th>Photos</th></tr>
${rows}
  </table>
${sections}
${dropSections}
</body>
</html>
`;
}

export async function runDiscover(
  rosterPath: string,
  opts?: { limitMembers?: number; root?: string },
): Promise<DiscoverSummary> {
  const base = opts?.root ?? process.cwd();
  const rosterRaw = JSON.parse(
    await readFile(path.resolve(base, rosterPath), "utf8").catch(
      (err: unknown) => {
        throw new Error(
          `cannot read roster ${rosterPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    ),
  ) as unknown;
  const rosterParsed = rosterSchema.safeParse(rosterRaw);
  if (!rosterParsed.success) {
    throw new Error(
      `invalid roster ${rosterPath}: ${rosterParsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const roster = rosterParsed.data;
  const entries =
    opts?.limitMembers !== undefined
      ? roster.roster.slice(0, opts.limitMembers)
      : roster.roster;
  const cacheDir = path.join(base, CACHE_DIR);
  const taken = new Set<string>();
  const kept: KeptMember[] = [];
  const dropped: DroppedMember[] = [];

  for (const entry of entries) {
    try {
      const { eligible, skippedCount } = await discoverMember(entry, cacheDir);
      const ranked = rankPhotos(eligible).slice(0, MAX_PHOTOS_PER_MEMBER);
      const memberId = slugifyMemberId(entry.fullName, taken);
      const withRarity = assignRarities(memberId, ranked);
      const photos = withRarity.map((p, i) => ({ ...p, photoNo: i + 1 }));
      kept.push({
        memberId,
        displayName: entry.name,
        fullName: entry.fullName,
        photos,
        skipped: skippedCount,
      });
      const mix = photos.map((p) => p.rarity).join(",");
      console.log(`kept ${memberId}: ${photos.length} photos [${mix}]`);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      dropped.push({ name: entry.name, reason });
      console.log(`dropped ${entry.name}: ${reason}`);
    }
  }

  kept.sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  const manifest = {
    schemaVersion: 1 as const,
    pool: roster.pool,
    group: { ...roster.group },
    members: kept.map((m) => ({
      id: m.memberId,
      name: m.displayName,
      fullName: m.fullName,
      photos: m.photos.map((p) => ({
        photoNo: p.photoNo,
        rarity: p.rarity,
        imageUrl: p.imageUrl,
        sourcePageUrl: p.sourcePageUrl,
        license: p.license,
        author: p.author,
      })),
    })),
  };
  const manifestParsed = groupManifestSchema.safeParse(manifest);
  if (!manifestParsed.success) {
    throw new Error(
      `manifest validation failed: ${manifestParsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const manifestPath = path.join(
    base,
    "data",
    "groups",
    roster.pool,
    `${roster.group.id}.json`,
  );
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifestParsed.data, null, 2)}\n`, "utf8");

  const reportPath = path.join(
    base,
    "data",
    "reports",
    `discover-${roster.group.id}.html`,
  );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, buildReport(roster.group.name, kept, dropped), "utf8");

  console.log(`manifest: ${path.relative(base, manifestPath)}`);
  console.log(`report: ${path.relative(base, reportPath)}`);
  return { kept, dropped, manifestPath, reportPath };
}

function parseArgs(argv: string[]): { roster: string; limitMembers?: number } {
  let roster: string | null = null;
  let limitMembers: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--roster") {
      const next = argv[i + 1];
      if (next === undefined || next === "") {
        throw new Error("--roster requires a path");
      }
      roster = next;
      i += 1;
    } else if (arg === "--limit-members") {
      const next = argv[i + 1];
      const n = next === undefined ? NaN : Number(next);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error("--limit-members requires a positive integer");
      }
      limitMembers = n;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (roster === null) throw new Error("missing required --roster <path>");
  return limitMembers === undefined ? { roster } : { roster, limitMembers };
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    await runDiscover(
      args.roster,
      args.limitMembers === undefined ? undefined : { limitMembers: args.limitMembers },
    );
  } catch (err: unknown) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
