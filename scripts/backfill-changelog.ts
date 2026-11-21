#!/usr/bin/env tsx
// Temporary backfill: posts curated summaries of PRs #53-#62 to #bot-changelog
// (oldest first). Run once via the "Backfill changelog" workflow, then delete
// this script + that workflow.
import { readFileSync } from "node:fs";

interface PRCommit {
  headline: string;
  sha: string;
}
interface PRItem {
  number: number;
  title: string;
  mergedAt: string;
  commits: PRCommit[];
}
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

const prs = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as PRItem[];

const escText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

// Curated English summaries keyed by PR number.
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
  55: {
    title: "Reusable reset-progress script",
    desc: "New permanent progress-reset script for local and remote D1. Already used once: remote reset from 215 cards / 278 pulls / 8 users to zero, with full stamina, open cooldowns, and zeroed pity.",
    highlights: ["Works on local + remote D1", "Resets cards, pulls, stamina, pity"],
  },
  56: {
    title: "Admin: clarified card name vs photo label + swap button",
    desc: "Fixed the swapped name/label semantics across the admin flow: import preview shows columns with guidance, import results echo Title/Subtitle correctly, detail pages render both, and a stable-id swap route plus batch guide round it out.",
    highlights: ["Import preview with guidance", "Stable-id name/label swap route", "Batch guide updated", "49/49 related tests green"],
  },
  57: {
    title: "Wishlist commands with wish pity (/wish, /unwish, /wishlist)",
    desc: "Wish up to 3 cards per pool (Holo must be typed exactly, Secret cannot be wished). Every 50th pull with an active wishlist grants a random wished card at 30%. Secret hard pity removed — Secret is pure luck now. Migration 0006 adds the wishes table.",
    highlights: ["/wish, /unwish, /wishlist commands", "Wish pity every 50 pulls (30% roll)", "Secret is pure luck again"],
  },
  58: {
    title: "Admin: promote photo label to member name",
    desc: "For cards where the photo label held a full person name, a new promote action moves the label into the member name (stable id, label cleared). 12 cards promoted on remote D1, 248 others re-rendered with zero failures.",
    highlights: ["New promote-label route + button", "12 cards fixed, 248 re-rendered"],
  },
  59: {
    title: "Automatic changelog posts to #bot-changelog",
    desc: "Every push to main now posts a commit summary to #bot-changelog via a Discord channel webhook — no bot code changes, up to 10 commits per message with an overflow counter.",
    highlights: ["Push-to-main webhook notifier", "10-commit cap + overflow counter", "Silent skip when secret is missing"],
  },
  60: {
    title: "One-click deploy announcements",
    desc: "After a manual deploy, operators run this workflow from the Actions tab with an optional note, and a deploy notice posts to #bot-changelog automatically — so the channel can stay fully locked.",
    highlights: ["Manual trigger with optional note", "Same webhook secret, no bot changes"],
  },
  61: {
    title: "Repo name hidden from changelog notices",
    desc: "Removed the repository name from changelog messages and hid raw commit URLs behind a 'view commit' link (compare link dropped entirely) for a cleaner, more private feed.",
    highlights: ["No owner/repo in message text", "Masked commit links"],
  },
  62: {
    title: "English-only changelog messages",
    desc: "Translated every #bot-changelog string to English and recorded the English-only rule in AGENTS.md so all future notices stay professional.",
    highlights: ["All-English titles, bodies, footers", "Rule pinned in AGENTS.md section 6"],
  },
};

const delay = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

for (const pr of prs) {
  const summary = OVERRIDES[pr.number] ?? { title: pr.title, desc: pr.title, highlights: [] };
  const { title, desc, highlights } = summary;
  const commitLines = pr.commits
    .slice(0, 5)
    .map((c) => `\`${escText(c.sha.slice(0, 7))}\` ${escText(c.headline.slice(0, 200))} ([view commit](https://github.com/${repo}/commit/${c.sha}))`)
    .join("\n");

  const fields: Array<{ name: string; value: string; inline: boolean }> = [{ name: "📌 Summary", value: desc || title, inline: false }];
  if (highlights.length > 0) {
    fields.push({ name: "✨ Highlights", value: highlights.map((p) => `• ${p}`).join("\n"), inline: false });
  }
  fields.push({ name: "📝 Commits", value: commitLines || "(none)", inline: false });

  const payload = {
    content: `📦 PR #${pr.number} merged — ${title}`,
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: `#${pr.number} ${title}`.slice(0, 256),
        description: (desc || title).slice(0, 2000),
        fields: fields.map((f) => ({ ...f, value: f.value.slice(0, 1024) })).slice(0, 25),
        ...(pr.commits.length > 5 ? { footer: { text: `…and ${pr.commits.length - 5} more commit(s)` } } : {}),
        timestamp: pr.mergedAt,
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
    console.error(`PR #${pr.number} failed: HTTP ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(`PR #${pr.number} posted (HTTP ${res.status})`);
  await delay(1500); // stay well under Discord rate limits
}
console.log(`Done: ${prs.length} messages posted.`);
