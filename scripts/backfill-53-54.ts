#!/usr/bin/env tsx
// Temporary backfill for PRs #53 and #54 only (missed by the first backfill).
// Run once via the "Backfill 53-54" workflow, then delete this script + workflow.
import { execFileSync } from "node:child_process";

interface Summary {
  title: string;
  desc: string;
  highlights: string[];
}

const webhook = process.env.CHANGELOG_WEBHOOK_URL;
if (!webhook) {
  console.error("CHANGELOG_WEBHOOK_URL not set");
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY ?? "";

const OVERRIDES: Record<number, Summary> = {
  53: {
    title: "Animated GIF rendering for Holo & Secret cards",
    desc: "Holo and Secret cards now render as looping GIF89a animations (400x600, 12 frames at 75ms) with rainbow shimmer, star sparkles, and an animated gradient border. All other rarities stay as static WebP. Uploads and the card-serving route now handle image/gif.",
    highlights: ["GIF89a loop for Holo/Secret via gifenc", "Static WebP kept for other rarities", "GIF upload + serving support", "New test suite: animated-cards (4/4 green)"],
  },
  54: {
    title: "Gacha rate rebalance + Secret hard pity",
    desc: "Rebalanced gacha weights from 96/58/23/16/6/1 to 300/70/20/7/2/1 and added a Secret hard pity: a guaranteed Secret within 200 pulls per user per pool (pity_secret column, additive migration 0005).",
    highlights: ["New weights: 300/70/20/7/2/1 (total 400)", "Secret hard pity at 200 pulls per pool", "Rates in /help follow automatically"],
  },
};

const escText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const delay = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));
const gh = (args: string[]): string => execFileSync("gh", args, { encoding: "utf8" });

for (const number of [53, 54]) {
  const raw = JSON.parse(gh(["pr", "view", String(number), "--json", "title,mergedAt,commits"])) as {
    title: string;
    mergedAt: string;
    commits: Array<{ messageHeadline: string; oid: string }>;
  };
  const summary = OVERRIDES[number] ?? { title: raw.title, desc: raw.title, highlights: [] };
  const commitLines = raw.commits
    .slice(0, 5)
    .map(
      (c) =>
        `\`${escText(c.oid.slice(0, 7))}\` ${escText(c.messageHeadline.slice(0, 200))} ([view commit](https://github.com/${repo}/commit/${c.oid}))`,
    )
    .join("\n");

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "\u{1F4CC} Summary", value: summary.desc, inline: false },
    {
      name: "\u2728 Highlights",
      value: summary.highlights.map((p) => `\u2022 ${p}`).join("\n"),
      inline: false,
    },
    { name: "\u{1F4DD} Commits", value: commitLines || "(none)", inline: false },
  ];

  const payload = {
    content: `\u{1F4E6} PR #${number} merged \u2014 ${summary.title}`,
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: `#${number} ${summary.title}`.slice(0, 256),
        description: summary.desc.slice(0, 2000),
        fields: fields.map((f) => ({ ...f, value: f.value.slice(0, 1024) })),
        timestamp: raw.mergedAt,
      },
    ],
  };

  const res = await fetch(`${webhook}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PR #${number} failed: HTTP ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(`PR #${number} posted (HTTP ${res.status})`);
  await delay(1500);
}
console.log("Done: 2 messages posted.");
