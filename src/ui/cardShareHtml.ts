import { escapeHtml } from "./albumHtml.js";
import { RARITY_LABEL, RARITY_STARS, type RarityKey } from "../domain/rarity.js";
import { cardDisplayName } from "../domain/gacha.js";

export interface SharedCardData {
  cardId: string;
  memberName: string;
  photoLabel: string | null;
  groupName: string;
  photoNo: number;
  photoTotal: number;
  serial: number;
  rarity: RarityKey;
  imageUrl: string;
}

export function cardShareTitle(card: SharedCardData): string {
  return `🎴 ${cardDisplayName(card.photoLabel, card.memberName)} (${card.groupName})`;
}
export function cardShareDescription(card: SharedCardData): string {
  const stars = RARITY_STARS[card.rarity];
  const label = RARITY_LABEL[card.rarity];
  const total = card.photoTotal <= 0 ? "?" : String(card.photoTotal);
  return `${stars} ${label} · Foto ${card.photoNo}/${total} · No. ${card.serial}`;
}

function ogHead(card: SharedCardData, pageUrl: string): string {
  const title = cardShareTitle(card);
  const description = cardShareDescription(card);
  return (
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${escapeHtml(title)}</title>` +
    `<meta property="og:type" content="website">` +
    `<meta property="og:site_name" content="Gatchawek Photocard">` +
    `<meta property="og:title" content="${escapeHtml(title)}">` +
    `<meta property="og:description" content="${escapeHtml(description)}">` +
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">` +
    `<meta property="og:image" content="${escapeHtml(card.imageUrl)}">` +
    `<meta property="og:image:alt" content="${escapeHtml(title)}">` +
    `<meta name="twitter:card" content="summary_large_image">` +
    `<meta name="twitter:title" content="${escapeHtml(title)}">` +
    `<meta name="twitter:description" content="${escapeHtml(description)}">` +
    `<meta name="twitter:image" content="${escapeHtml(card.imageUrl)}">`
  );
}

/**
 * Minimal HTML for link-preview crawlers: OG tags only, no card art needed.
 * Mirrors albumCrawlerPreviewPage's crawler-only contract.
 */
export function cardShareCrawlerPage(
  card: SharedCardData,
  pageUrl: string,
): string {
  const title = cardShareTitle(card);
  const description = cardShareDescription(card);
  return (
    `<!doctype html><html lang="id"><head>${ogHead(card, pageUrl)}</head>` +
    `<body><main><h1>${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(description)}</p>` +
    `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(title)}">` +
    `</main></body></html>`
  );
}

const RARITY_FRAME: Record<RarityKey, { frame: string; stamp: string }> = {
  common: { frame: "#8d99ae", stamp: "#8d99ae" },
  rare: { frame: "#3a86ff", stamp: "#3a86ff" },
  super_rare: { frame: "#8338ec", stamp: "#b5179e" },
  ultra_rare: { frame: "#ff9e00", stamp: "#f48c06" },
  holo: { frame: "#06d6a0", stamp: "#06d6a0" },
  secret: { frame: "#e63946", stamp: "#e63946" },
};

/**
 * Human view: one physical photocard on a navy backdrop — frame in the
 * rarity color, gold-foil stamp rotated over the corner, caption beneath.
 * No card-grid, no SaaS chrome: the card is the whole page.
 */
export function cardSharePage(card: SharedCardData, pageUrl: string): string {
  const title = cardShareTitle(card);
  const description = cardShareDescription(card);
  const colors = RARITY_FRAME[card.rarity] ?? RARITY_FRAME.common;
  const label = RARITY_LABEL[card.rarity];
  return `<!doctype html>
<html lang="id">
<head>${ogHead(card, pageUrl)}
<style>
:root{--frame:${colors.frame};--stamp:${colors.stamp}}
*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:grid;place-items:center;padding:40px 20px;
background:radial-gradient(120% 90% at 50% 0%,#22304d 0%,#101828 55%,#0a0f1c 100%);
font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4f1ea}
.photocard{width:min(380px,92vw);background:#fdfcf8;border-radius:18px;overflow:hidden;
box-shadow:0 30px 80px rgba(0,0,0,.55);border:6px solid var(--frame)}
.photocard img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#101828}
.stamp-row{display:flex;justify-content:flex-end;padding:14px 16px 0}
.stamp{transform:rotate(6deg);border:2px solid var(--stamp);color:var(--stamp);
font-weight:700;font-size:13px;letter-spacing:.14em;padding:4px 12px;border-radius:6px}
.caption{padding:12px 20px 22px;text-align:center;color:#1c2433}
.caption h1{font-size:22px;line-height:1.25}
.caption p{margin-top:6px;font-size:15px;color:#5b6472}
.hint{margin-top:26px;font-size:13px;color:#9aa4b2}
</style>
</head>
<body>
<main>
<figure class="photocard">
<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(title)}" fetchpriority="high">
<div class="stamp-row"><span class="stamp">${escapeHtml(label.toUpperCase())}</span></div>
<figcaption class="caption"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></figcaption>
</figure>
<p class="hint">Ditarik dari Discord · Gatchawek Photocard</p>
</main>
</body>
</html>`;
}
