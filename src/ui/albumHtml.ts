import type { AlbumBinderData } from "../db/queries/album.js";
import { RARITY_LABEL, RARITY_STARS } from "../domain/rarity.js";

const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=JetBrains+Mono:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Safely serialize JSON inside an inline <script> tag without XSS or </script> breakouts. */
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export type AlbumInvalidReason = "not-found" | "already-used" | "expired";

export function albumCrawlerPreviewPage(): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Buku Koleksi Photocard · Tautan Sekali Pakai</title><meta property="og:title" content="Buku Koleksi Photocard (Sekali Pakai)"><meta property="og:description" content="Buka tautan ini di browser untuk melihat binder koleksi photocard interaktifmu."></head><body><main><h1>Buku Koleksi Photocard</h1><p>Tautan sekali pakai siap dibuka di browser.</p></main></body></html>`;
}

export function albumExpiredPage(
  reason: AlbumInvalidReason,
  timestampSec?: number,
): string {
  let heading = "Tautan Buku Koleksi Tidak Ditemukan";
  let explanation =
    "Kode tautan ini tidak terdaftar di catatan binder. Jalankan command /album di server Discord untuk membuat tautan baru.";
  let badgeText = "Tautan Tidak Valid";

  if (reason === "already-used") {
    heading = "Tautan Sekali Pakai Sudah Terpakai";
    badgeText = "Sesi Telah Digunakan";
    const timeNote =
      timestampSec !== undefined
        ? ` pada ${new Date(timestampSec * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
        : "";
    explanation = `Demi menjaga privasi koleksimu, setiap tautan /album hanya berlaku untuk satu kali buka${timeNote}. Ketik /album lagi di channel Discord untuk membuka kembali buku koleksimu dengan tautan baru.`;
  } else if (reason === "expired") {
    heading = "Tautan Buku Koleksi Kedaluwarsa";
    badgeText = "Melewati Batas 15 Menit";
    explanation =
      "Tautan ini belum sempat dibuka dalam batas waktu 15 menit sehingga otomatis ditutup. Jalankan /album di Discord untuk membuat tautan baru.";
  }

  return `<!doctype html>
<html lang="id" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(heading)} · Gatchawek Binder</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS_URL}">
  <style>
    :root {
      --bg: #131016;
      --surface: #1e1922;
      --border: #382f3f;
      --text: #f5f0e6;
      --muted: #b8ae9f;
      --accent: #eab308;
      --accent-bg: rgba(234, 179, 8, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 50% 20%, #241d29 0%, var(--bg) 70%);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 1.5rem;
    }
    header, footer {
      max-width: 34rem;
      width: 100%;
      margin: 0 auto;
      color: var(--muted);
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    main {
      max-width: 34rem;
      width: 100%;
      margin: 2rem auto;
      background: var(--surface);
      border: 2px dashed var(--border);
      border-radius: 18px;
      padding: 2.25rem 1.75rem;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.55);
      text-align: left;
    }
    .seal {
      display: inline-block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-bg);
      border: 1px solid rgba(234, 179, 8, 0.4);
      padding: 0.35rem 0.7rem;
      border-radius: 6px;
      margin-bottom: 1rem;
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: clamp(1.45rem, 4vw, 1.85rem);
      line-height: 1.25;
      margin: 0 0 0.85rem;
      color: var(--text);
    }
    p {
      margin: 0 0 1.25rem;
      line-height: 1.65;
      color: var(--muted);
      font-size: 0.98rem;
    }
    .cmd-box {
      background: #120f15;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.95rem 1.1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.92rem;
      color: var(--accent);
    }
  </style>
</head>
<body>
  <header>
    <span>Arsip Kolektor Gatchawek</span>
    <span>Keamanan Tautan Sekali Pakai</span>
  </header>
  <main>
    <span class="seal">${escapeHtml(badgeText)}</span>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(explanation)}</p>
    <div class="cmd-box">Jalankan di Discord: <strong>/album</strong></div>
  </main>
  <footer>
    <span>Buku Pengumpul Kartu Pribadi</span>
    <span>Sesi Tertutup</span>
  </footer>
</body>
</html>`;
}

export function albumBinderPage(binder: AlbumBinderData): string {
  const initialJson = safeJsonForScript({
    userId: binder.userId,
    displayName: binder.displayName,
    avatarUrl: binder.avatarUrl,
    initialPoolId: binder.initialPoolId,
    generatedAt: binder.generatedAt,
    summary: binder.summary,
    pools: binder.pools,
    groups: binder.groups,
    slots: binder.slots,
    rarityLabels: RARITY_LABEL,
    rarityStars: RARITY_STARS,
  });

  const pct =
    binder.summary.totalCatalogCards > 0
      ? Math.round(
          (binder.summary.uniqueOwnedCards / binder.summary.totalCatalogCards) *
            100,
        )
      : 0;

  const avatarBlock =
    binder.avatarUrl !== null && binder.avatarUrl !== ""
      ? `<img class="collector-avatar" src="${escapeHtml(binder.avatarUrl)}" alt="Avatar ${escapeHtml(binder.displayName)}" width="48" height="48" fetchpriority="high">`
      : `<span class="collector-monogram" aria-hidden="true">${escapeHtml(binder.displayName.slice(0, 1).toUpperCase() || "K")}</span>`;

  return `<!doctype html>
<html lang="id" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Buku Koleksi ${escapeHtml(binder.displayName)} · Binder Photocard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS_URL}">
  <style>
    :root, html[data-theme="dark"] {
      --desk-bg: #120f14;
      --desk-grain: #1a151e;
      --leather-outer: #231c26;
      --leather-inner: #18131b;
      --leather-stitch: rgba(234, 179, 8, 0.36);
      --sheet-bg: #1d1821;
      --sheet-alt: #241e29;
      --sheet-border: #393040;
      --pocket-bg: rgba(255, 255, 255, 0.03);
      --pocket-border: rgba(255, 255, 255, 0.16);
      --pocket-seam: rgba(255, 255, 255, 0.22);
      --pocket-sheen: linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.02) 38%, rgba(255,255,255,0) 65%);
      --text-main: #f6f1e7;
      --text-muted: #bfb5a4;
      --text-dim: #928779;
      --accent: #facc15;
      --accent-strong: #eab308;
      --accent-ink: #181206;
      --accent-soft: rgba(250, 204, 21, 0.15);
      --ring-metal: linear-gradient(90deg, #6b655e 0%, #e5e0d8 35%, #ffffff 50%, #8c857b 80%, #4a453f 100%);
      --spine-shadow: rgba(0, 0, 0, 0.65);
      --focus-ring: #facc15;
    }
    html[data-theme="light"] {
      --desk-bg: #e6dec8;
      --desk-grain: #dcd2ba;
      --leather-outer: #4a3525;
      --leather-inner: #362519;
      --leather-stitch: rgba(245, 222, 179, 0.48);
      --sheet-bg: #f7f2e7;
      --sheet-alt: #efe8d8;
      --sheet-border: #cfc3ab;
      --pocket-bg: rgba(30, 22, 12, 0.035);
      --pocket-border: rgba(84, 64, 42, 0.24);
      --pocket-seam: rgba(84, 64, 42, 0.32);
      --pocket-sheen: linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0) 70%);
      --text-main: #231a12;
      --text-muted: #574838;
      --text-dim: #73614e;
      --accent: #9a5b04;
      --accent-strong: #b45309;
      --accent-ink: #ffffff;
      --accent-soft: rgba(180, 83, 9, 0.13);
      --ring-metal: linear-gradient(90deg, #5e5850 0%, #d8d1c5 35%, #ffffff 50%, #7d766c 80%, #3d3833 100%);
      --spine-shadow: rgba(35, 22, 10, 0.32);
      --focus-ring: #9a5b04;
    }
    * { box-sizing: border-box; }
    a[href], button, select, summary, label[for], [role="button"], [role="tab"] {
      cursor: pointer;
    }
    button:disabled, select:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }
    :focus-visible {
      outline: 3px solid var(--focus-ring);
      outline-offset: 2px;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background-color: var(--desk-bg);
      background-image: radial-gradient(circle at 50% 0%, var(--desk-grain) 0%, var(--desk-bg) 78%);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }
    .desk-header {
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      padding: 1.15rem 1.25rem 0.75rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .collector-brand {
      display: flex;
      align-items: center;
      gap: 0.9rem;
    }
    .collector-avatar, .collector-monogram {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 2px solid var(--accent);
      object-fit: cover;
      flex-shrink: 0;
    }
    .collector-monogram {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--accent-soft);
      color: var(--accent);
      font-family: 'Fraunces', Georgia, serif;
      font-weight: 700;
      font-size: 1.25rem;
    }
    .brand-titles h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: clamp(1.25rem, 2.6vw, 1.65rem);
      margin: 0;
      line-height: 1.2;
    }
    .session-notice {
      margin: 0.2rem 0 0;
      font-size: 0.82rem;
      color: var(--text-muted);
    }
    .header-right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.65rem;
    }
    .stat-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      background: var(--sheet-bg);
      border: 1px solid var(--sheet-border);
      border-radius: 10px;
      padding: 0.45rem 0.75rem;
      font-size: 0.84rem;
    }
    .stat-item {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--text-muted);
    }
    .stat-item strong {
      color: var(--text-main);
      font-family: 'JetBrains Mono', monospace;
    }
    .tool-btn {
      min-height: 44px;
      padding: 0.5rem 0.85rem;
      border-radius: 10px;
      border: 1px solid var(--sheet-border);
      background: var(--sheet-bg);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.84rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
    }
    .tool-btn:hover:not(:disabled) {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .tool-btn:active:not(:disabled) {
      transform: translateY(0);
    }
    .binder-nav {
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      padding: 0.35rem 1.25rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .pool-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }
    .pool-tab {
      min-height: 44px;
      padding: 0.5rem 0.95rem;
      border-radius: 10px 10px 4px 4px;
      border: 1px solid var(--sheet-border);
      background: var(--sheet-bg);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
    }
    .pool-tab:hover {
      color: var(--text-main);
      border-color: var(--accent);
    }
    .pool-tab[aria-selected="true"] {
      background: var(--accent-strong);
      color: var(--accent-ink);
      border-color: var(--accent-strong);
      transform: translateY(-2px);
    }
    .tab-count {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.76rem;
      padding: 0.12rem 0.42rem;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.22);
      color: inherit;
    }
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      background: var(--sheet-bg);
      border: 1px solid var(--sheet-border);
      border-radius: 12px;
      padding: 0.6rem 0.85rem;
    }
    .filter-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.55rem;
    }
    .field-inline {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.83rem;
      color: var(--text-muted);
    }
    .field-inline select, .field-inline input {
      min-height: 44px;
      padding: 0.45rem 0.7rem;
      border-radius: 8px;
      border: 1px solid var(--sheet-border);
      background: var(--sheet-alt);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.85rem;
    }
    .field-inline input {
      min-width: 180px;
    }
    .mode-switch {
      display: inline-flex;
      border-radius: 8px;
      border: 1px solid var(--sheet-border);
      overflow: hidden;
      background: var(--sheet-alt);
    }
    .mode-btn {
      min-height: 44px;
      padding: 0.45rem 0.75rem;
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .mode-btn[aria-pressed="true"] {
      background: var(--accent-strong);
      color: var(--accent-ink);
    }
    .binder-stage {
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      padding: 0.25rem 1.25rem 1.25rem;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    /* Physical leather binder outer cover */
    .leather-cover {
      position: relative;
      background: var(--leather-outer);
      border-radius: 24px;
      padding: 16px;
      box-shadow:
        0 28px 60px rgba(0, 0, 0, 0.65),
        inset 0 2px 3px rgba(255, 255, 255, 0.12),
        inset 0 -3px 6px rgba(0, 0, 0, 0.6);
      border: 2px solid rgba(255, 255, 255, 0.08);
    }
    .leather-stitch {
      border: 2px dashed var(--leather-stitch);
      border-radius: 18px;
      padding: 12px;
      background: var(--leather-inner);
      position: relative;
    }
    /* Open 2-page book spread */
    .book-viewport {
      position: relative;
      perspective: 2000px;
    }
    .book-spread {
      display: grid;
      grid-template-columns: 1fr 38px 1fr;
      background: var(--sheet-bg);
      border-radius: 14px;
      border: 1px solid var(--sheet-border);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
      overflow: hidden;
      position: relative;
      transform-style: preserve-3d;
      transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s ease;
    }
    .book-spread.turning-next {
      animation: pageFlipNext 0.44s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .book-spread.turning-prev {
      animation: pageFlipPrev 0.44s cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes pageFlipNext {
      0% { transform: rotateY(0deg) scale(1); }
      40% { transform: rotateY(-11deg) scale(0.985); }
      100% { transform: rotateY(0deg) scale(1); }
    }
    @keyframes pageFlipPrev {
      0% { transform: rotateY(0deg) scale(1); }
      40% { transform: rotateY(11deg) scale(0.985); }
      100% { transform: rotateY(0deg) scale(1); }
    }
    .binder-page {
      padding: 1.15rem 1.15rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
      position: relative;
      background: var(--sheet-bg);
    }
    .binder-page-left {
      background-image: linear-gradient(90deg, rgba(0,0,0,0) 86%, var(--spine-shadow) 100%);
    }
    .binder-page-right {
      background-image: linear-gradient(270deg, rgba(0,0,0,0) 86%, var(--spine-shadow) 100%);
    }
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.78rem;
      color: var(--text-dim);
      border-bottom: 1px dashed var(--sheet-border);
      padding-bottom: 0.45rem;
    }
    .page-header h2 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 0.95rem;
      font-weight: 600;
      margin: 0;
      color: var(--text-muted);
    }
    .page-num-stamp {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
    }
    /* Center 3-ring metal spine */
    .binder-spine {
      background: linear-gradient(90deg, #110d13 0%, #2b2330 50%, #110d13 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-around;
      padding: 2rem 0;
      position: relative;
      box-shadow: inset 0 0 14px rgba(0, 0, 0, 0.85);
    }
    .spine-ring {
      width: 48px;
      height: 16px;
      border-radius: 8px;
      background: var(--ring-metal);
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.75),
        inset 0 1px 2px rgba(255, 255, 255, 0.8);
      position: relative;
      z-index: 2;
    }
    .spine-ring::before, .spine-ring::after {
      content: "";
      position: absolute;
      top: 2px;
      width: 10px;
      height: 12px;
      border-radius: 50%;
      background: #0d0a0f;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.9);
    }
    .spine-ring::before { left: -4px; }
    .spine-ring::after { right: -4px; }
    /* 3x2 PVC pocket grid per page */
    .pocket-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.85rem;
      flex: 1;
    }
    /* Individual PVC Card Pocket */
    .pocket {
      position: relative;
      aspect-ratio: 2 / 3;
      border-radius: 12px;
      background: var(--pocket-bg);
      border: 1px solid var(--pocket-border);
      padding: 6px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s ease, box-shadow 0.22s ease;
    }
    /* Heat-welded vinyl pocket stitch border */
    .pocket::before {
      content: "";
      position: absolute;
      inset: 3px;
      border: 1px dashed var(--pocket-seam);
      border-radius: 9px;
      pointer-events: none;
      z-index: 4;
    }
    /* Top vinyl pocket insertion slit + diagonal plastic sleeve sheen */
    .pocket::after {
      content: "";
      position: absolute;
      inset: 0;
      background: var(--pocket-sheen);
      border-top: 2px solid rgba(255, 255, 255, 0.24);
      pointer-events: none;
      z-index: 5;
      opacity: 0.78;
      transition: opacity 0.2s ease;
    }
    button.pocket-card-btn {
      all: unset;
      cursor: pointer;
      position: relative;
      width: 100%;
      height: 100%;
      display: block;
      border-radius: 8px;
      overflow: hidden;
    }
    button.pocket-card-btn:focus-visible {
      outline: 3px solid var(--focus-ring);
      outline-offset: 2px;
    }
    .pocket.owned:hover, .pocket.owned:focus-within {
      transform: translateY(-5px);
      border-color: var(--accent);
      box-shadow: 0 14px 26px rgba(0, 0, 0, 0.48);
    }
    .pocket.owned:hover .card-img-wrap,
    .pocket.owned:focus-within .card-img-wrap {
      transform: translateY(-4px) scale(1.02);
    }
    .card-img-wrap {
      width: 100%;
      height: 100%;
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      background: #141118;
      transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .card-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      aspect-ratio: 2 / 3;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .card-img.loaded {
      opacity: 1;
    }
    .img-skeleton {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      color: var(--text-dim);
      background: linear-gradient(110deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%;
      animation: pulseLoad 1.6s infinite;
    }
    @keyframes pulseLoad {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }
    /* Pocket badges (qty, holo, serial) */
    .pocket-badges {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 6;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      pointer-events: none;
    }
    .badge-qty, .badge-holo {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.16rem 0.45rem;
      border-radius: 6px;
      backdrop-filter: blur(4px);
    }
    .badge-qty {
      background: rgba(12, 10, 16, 0.84);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.22);
    }
    .badge-holo {
      background: linear-gradient(135deg, rgba(250, 204, 21, 0.92), rgba(244, 114, 182, 0.92), rgba(56, 189, 248, 0.92));
      color: #0f172a;
      border: 1px solid #ffffff;
    }
    /* Empty / Unowned PVC sleeve slot */
    .empty-sleeve {
      width: 100%;
      height: 100%;
      border-radius: 8px;
      padding: 0.7rem 0.55rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
      color: var(--text-dim);
      user-select: none;
    }
    .empty-serial {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.74rem;
      font-weight: 700;
      opacity: 0.8;
    }
    .empty-emblem {
      width: 44px;
      height: 62px;
      border-radius: 6px;
      border: 1.5px dashed var(--pocket-seam);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      opacity: 0.7;
    }
    .empty-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
    }
    .empty-name {
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-photo {
      font-size: 0.68rem;
      color: var(--text-dim);
    }
    /* Rarity border accents on owned pockets */
    .pocket.owned[data-rarity="rare"] { border-color: rgba(168, 85, 247, 0.45); }
    .pocket.owned[data-rarity="super_rare"] { border-color: rgba(245, 158, 11, 0.55); }
    .pocket.owned[data-rarity="ultra_rare"] { border-color: rgba(236, 72, 153, 0.6); }
    .pocket.owned[data-rarity="holo"] { border-color: rgba(250, 204, 21, 0.8); }
    .pocket.owned[data-rarity="secret"] { border-color: rgba(34, 211, 238, 0.85); }

    /* Binder Page Controls Bar */
    .page-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      background: var(--sheet-bg);
      border: 1px solid var(--sheet-border);
      border-radius: 12px;
      padding: 0.65rem 1rem;
    }
    .nav-btn {
      min-height: 44px;
      padding: 0.55rem 1.05rem;
      border-radius: 10px;
      border: 1px solid var(--sheet-border);
      background: var(--sheet-alt);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .nav-btn:hover:not(:disabled) {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .page-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      text-align: center;
    }
    .page-indicator strong {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 0.98rem;
    }
    .page-indicator span {
      font-size: 0.76rem;
      color: var(--text-muted);
    }
    /* Empty Filter / Collection State */
    .binder-empty-state {
      grid-column: 1 / -1;
      padding: 3rem 1.5rem;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
    }
    .binder-empty-state h3 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 1.25rem;
      margin: 0;
    }
    .binder-empty-state p {
      margin: 0;
      max-width: 28rem;
      color: var(--text-muted);
      font-size: 0.92rem;
      line-height: 1.55;
    }
    /* 3D Interactive Card Inspection Lightbox Modal */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(8, 6, 12, 0.86);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
    }
    .modal-backdrop[hidden] {
      display: none;
    }
    .modal-dialog {
      max-width: 880px;
      width: 100%;
      background: var(--sheet-bg);
      border: 1px solid var(--sheet-border);
      border-radius: 20px;
      padding: 1.5rem;
      box-shadow: 0 32px 72px rgba(0, 0, 0, 0.75);
      display: grid;
      grid-template-columns: minmax(250px, 340px) 1fr;
      gap: 1.75rem;
      align-items: center;
      position: relative;
    }
    .inspect-stage {
      perspective: 1400px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }
    .card-3d-rig {
      width: 100%;
      max-width: 310px;
      aspect-ratio: 2 / 3;
      position: relative;
      transform-style: preserve-3d;
      transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
      transition: transform 0.12s ease-out;
    }
    .card-3d-rig.is-flipped {
      transform: rotateX(var(--rx, 0deg)) rotateY(calc(180deg + var(--ry, 0deg)));
      transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .card-face {
      position: absolute;
      inset: 0;
      border-radius: 16px;
      overflow: hidden;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      box-shadow: 0 22px 44px rgba(0, 0, 0, 0.65);
    }
    .card-face-front img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    /* Dynamic pointer-reactive holographic foil glare */
    .card-glare {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(
        circle at var(--gx, 50%) var(--gy, 35%),
        rgba(255, 255, 255, 0.38) 0%,
        rgba(250, 204, 21, 0.14) 26%,
        rgba(56, 189, 248, 0.12) 48%,
        rgba(255, 255, 255, 0) 72%
      );
      mix-blend-mode: screen;
      opacity: var(--glare-alpha, 0.35);
      transition: opacity 0.2s ease;
    }
    .card-face-back {
      transform: rotateY(180deg);
      background: linear-gradient(155deg, #1f1924 0%, #120e16 100%);
      border: 2px solid var(--accent);
      padding: 1.35rem 1.15rem;
      color: #f6f1e7;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
    }
    .back-inner-border {
      border: 1px dashed rgba(250, 204, 21, 0.45);
      border-radius: 12px;
      height: 100%;
      padding: 1.15rem 0.9rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .back-crest {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 1.15rem;
      color: #facc15;
    }
    .back-serial {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.4rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0.35rem 0;
    }
    .back-stamp-list {
      text-align: left;
      font-size: 0.78rem;
      color: #cfc6b8;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      padding: 0.75rem 0;
    }
    .back-stamp-row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .back-stamp-row strong {
      font-family: 'JetBrains Mono', monospace;
      color: #ffffff;
    }
    .inspect-hint {
      font-size: 0.76rem;
      color: var(--text-dim);
      text-align: center;
    }
    .inspect-details {
      display: flex;
      flex-direction: column;
      gap: 0.95rem;
    }
    .inspect-header h2 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: clamp(1.35rem, 2.5vw, 1.75rem);
      margin: 0.25rem 0 0.15rem;
    }
    .inspect-subtitle {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    .rarity-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 0.28rem 0.65rem;
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
    }
    .meta-box {
      background: var(--sheet-alt);
      border: 1px solid var(--sheet-border);
      border-radius: 10px;
      padding: 0.65rem 0.8rem;
    }
    .meta-label {
      font-size: 0.74rem;
      color: var(--text-dim);
      margin-bottom: 0.2rem;
    }
    .meta-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .modal-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      margin-top: 0.35rem;
    }
    .desk-footer {
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      padding: 0.75rem 1.25rem 1.5rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-dim);
    }
    @media (max-width: 960px) {
      .book-spread {
        grid-template-columns: 1fr;
      }
      .binder-spine {
        flex-direction: row;
        padding: 0.45rem 1.5rem;
        height: 28px;
      }
      .spine-ring {
        width: 16px;
        height: 36px;
      }
      .modal-dialog {
        grid-template-columns: 1fr;
        max-height: 92vh;
        overflow-y: auto;
      }
    }
    @media (max-width: 540px) {
      .pocket-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .leather-cover {
        padding: 8px;
        border-radius: 16px;
      }
      .leather-stitch {
        padding: 8px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <header class="desk-header">
    <div class="collector-brand">
      ${avatarBlock}
      <div class="brand-titles">
        <h1>Buku Koleksi ${escapeHtml(binder.displayName)}</h1>
        <p class="session-notice">Tautan sekali pakai telah digunakan untuk membuka sesi ini (${pct}% katalog terkumpul)</p>
      </div>
    </div>
    <div class="header-right">
      <div class="stat-strip" aria-label="Ringkasan koleksi">
        <span class="stat-item">Kartu <strong>${binder.summary.uniqueOwnedCards}/${binder.summary.totalCatalogCards}</strong></span>
        <span class="stat-item">· Member <strong>${binder.summary.uniqueOwnedMembers}/${binder.summary.totalCatalogMembers}</strong></span>
        <span class="stat-item">· Lembar <strong>×${binder.summary.totalCopies}</strong></span>
        ${binder.summary.totalHoloCopies > 0 ? `<span class="stat-item">· Holo <strong>✦×${binder.summary.totalHoloCopies}</strong></span>` : ""}
      </div>
      <button type="button" id="soundToggle" class="tool-btn" aria-pressed="true">Suara Kertas: Aktif</button>
      <button type="button" id="themeToggle" class="tool-btn">Tema: Gelap</button>
    </div>
  </header>

  <nav class="binder-nav" aria-label="Filter dan tab binder">
    <div class="pool-tabs" id="poolTabs" role="tablist" aria-label="Tab Pool"></div>
    <div class="filter-bar">
      <div class="filter-group">
        <div class="field-inline">
          <label for="groupSelect">Seri / Grup</label>
          <select id="groupSelect"></select>
        </div>
        <div class="field-inline">
          <label for="raritySelect">Rarity</label>
          <select id="raritySelect">
            <option value="all">Semua Rarity</option>
            <option value="secret">★★★★★★ Secret</option>
            <option value="holo">★★★★★ Holo</option>
            <option value="ultra_rare">★★★★ Ultra Rare</option>
            <option value="super_rare">★★★ Super Rare</option>
            <option value="rare">★★ Rare</option>
            <option value="common">★ Common</option>
          </select>
        </div>
        <div class="field-inline">
          <label for="searchInput">Cari</label>
          <input id="searchInput" type="search" placeholder="Nama member, label, atau #serial" autocomplete="off">
        </div>
      </div>
      <div class="filter-group">
        <div class="mode-switch" role="group" aria-label="Tampilan slot kantong">
          <button type="button" class="mode-btn" data-mode="all" aria-pressed="true">Semua Slot</button>
          <button type="button" class="mode-btn" data-mode="owned" aria-pressed="false">Dimiliki</button>
          <button type="button" class="mode-btn" data-mode="missing" aria-pressed="false">Belum Ada</button>
        </div>
      </div>
    </div>
  </nav>

  <main class="binder-stage">
    <div class="leather-cover">
      <div class="leather-stitch">
        <div class="book-viewport">
          <div class="book-spread" id="bookSpread">
            <section class="binder-page binder-page-left" aria-labelledby="leftPageTitle">
              <div class="page-header">
                <h2 id="leftPageTitle">Halaman Kiri</h2>
                <span class="page-num-stamp" id="leftPageNum">Hal. 1</span>
              </div>
              <div class="pocket-grid" id="leftPocketGrid"></div>
            </section>

            <div class="binder-spine" aria-hidden="true">
              <div class="spine-ring"></div>
              <div class="spine-ring"></div>
              <div class="spine-ring"></div>
            </div>

            <section class="binder-page binder-page-right" aria-labelledby="rightPageTitle">
              <div class="page-header">
                <h2 id="rightPageTitle">Halaman Kanan</h2>
                <span class="page-num-stamp" id="rightPageNum">Hal. 2</span>
              </div>
              <div class="pocket-grid" id="rightPocketGrid"></div>
            </section>
          </div>
        </div>
      </div>
    </div>

    <div class="page-controls">
      <button type="button" id="prevSpreadBtn" class="nav-btn">‹ Balik Lembar Sebelumnya</button>
      <div class="page-indicator">
        <strong id="spreadStatusText">Lembar 1 dari 1</strong>
        <span id="spreadSubText">Menampilkan 0 kantong kartu</span>
      </div>
      <button type="button" id="nextSpreadBtn" class="nav-btn">Balik Lembar Berikutnya ›</button>
    </div>
  </main>

  <div class="modal-backdrop" id="cardModal" role="dialog" aria-modal="true" aria-labelledby="inspectTitle" hidden>
    <div class="modal-dialog">
      <div class="inspect-stage">
        <div class="card-3d-rig" id="card3dRig">
          <div class="card-face card-face-front">
            <img id="inspectImg" src="" alt="" width="400" height="600">
            <div class="card-glare" id="cardGlare"></div>
          </div>
          <div class="card-face card-face-back">
            <div class="back-inner-border">
              <div>
                <div class="back-crest">Arsip Resmi Gatchawek</div>
                <div class="back-serial" id="backSerial">No. 1</div>
              </div>
              <div class="back-stamp-list" id="backStampList"></div>
              <div style="font-size:0.72rem;color:#928779">Sertifikat Kepemilikan Kolektor</div>
            </div>
          </div>
        </div>
        <span class="inspect-hint">Gerakkan kursor di atas kartu untuk efek kilau 3D</span>
      </div>

      <div class="inspect-details">
        <div class="inspect-header">
          <span class="rarity-pill" id="inspectRarityPill">★ Common</span>
          <h2 id="inspectTitle">Nama Kartu</h2>
          <p class="inspect-subtitle" id="inspectSubtitle">Seri · Member</p>
        </div>

        <div class="meta-grid" id="inspectMetaGrid"></div>

        <div class="modal-actions">
          <button type="button" id="flipCardBtn" class="tool-btn">Balik Kartu (Lihat Belakang)</button>
          <button type="button" id="prevCardBtn" class="tool-btn">‹ Kartu Sebelumnya</button>
          <button type="button" id="nextCardBtn" class="tool-btn">Kartu Berikutnya ›</button>
          <button type="button" id="closeModalBtn" class="tool-btn">Masukkan Kembali ke Kantong (Esc)</button>
        </div>
      </div>
    </div>
  </div>

  <footer class="desk-footer">
    <span>Gunakan tombol panah kiri/kanan pada keyboard atau geser layar untuk membalik halaman binder.</span>
    <span>Klik kartu yang dimiliki untuk mengangkat kartu dari kantong plastik PVC.</span>
  </footer>

  <script id="albumData" type="application/json">${initialJson}</script>
  <script>
    (function () {
      const dataEl = document.getElementById("albumData");
      if (!dataEl) return;
      const BINDER = JSON.parse(dataEl.textContent || "{}");
      const POCKETS_PER_PAGE = 6;
      const POCKETS_PER_SPREAD = 12;

      const state = {
        poolId: BINDER.initialPoolId || "all",
        groupId: "all",
        rarity: "all",
        mode: "all",
        search: "",
        spreadIndex: 0,
        soundEnabled: true,
        theme: "dark",
        activeCardId: null,
        isFlipped: false,
      };

      const poolById = new Map((BINDER.pools || []).map((p) => [p.id, p]));
      const groupById = new Map((BINDER.groups || []).map((g) => [g.id, g]));

      // Subtle Web Audio synthesized page-flip & sleeve-slide rustle
      let audioCtx = null;
      function playPaperSound(kind) {
        if (!state.soundEnabled) return;
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          if (!audioCtx) audioCtx = new Ctx();
          if (audioCtx.state === "suspended") audioCtx.resume();
          const dur = kind === "flip" ? 0.14 : 0.08;
          const len = Math.floor(audioCtx.sampleRate * dur);
          const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
          const out = buf.getChannelData(0);
          for (let i = 0; i < len; i++) {
            const env = Math.sin((i / len) * Math.PI);
            out[i] = (Math.random() * 2 - 1) * env * (kind === "flip" ? 0.09 : 0.05);
          }
          const src = audioCtx.createBufferSource();
          src.buffer = buf;
          const filter = audioCtx.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.value = kind === "flip" ? 1100 : 1800;
          filter.Q.value = 1.2;
          src.connect(filter);
          filter.connect(audioCtx.destination);
          src.start();
        } catch (_e) {
          // Ignore audio block
        }
      }

      const poolTabsEl = document.getElementById("poolTabs");
      const groupSelectEl = document.getElementById("groupSelect");
      const raritySelectEl = document.getElementById("raritySelect");
      const searchInputEl = document.getElementById("searchInput");
      const bookSpreadEl = document.getElementById("bookSpread");
      const leftGridEl = document.getElementById("leftPocketGrid");
      const rightGridEl = document.getElementById("rightPocketGrid");
      const leftPageTitleEl = document.getElementById("leftPageTitle");
      const rightPageTitleEl = document.getElementById("rightPageTitle");
      const leftPageNumEl = document.getElementById("leftPageNum");
      const rightPageNumEl = document.getElementById("rightPageNum");
      const prevSpreadBtn = document.getElementById("prevSpreadBtn");
      const nextSpreadBtn = document.getElementById("nextSpreadBtn");
      const spreadStatusText = document.getElementById("spreadStatusText");
      const spreadSubText = document.getElementById("spreadSubText");
      const soundToggleBtn = document.getElementById("soundToggle");
      const themeToggleBtn = document.getElementById("themeToggle");

      const modalEl = document.getElementById("cardModal");
      const rigEl = document.getElementById("card3dRig");
      const inspectImgEl = document.getElementById("inspectImg");
      const inspectRarityPillEl = document.getElementById("inspectRarityPill");
      const inspectTitleEl = document.getElementById("inspectTitle");
      const inspectSubtitleEl = document.getElementById("inspectSubtitle");
      const inspectMetaGridEl = document.getElementById("inspectMetaGrid");
      const backSerialEl = document.getElementById("backSerial");
      const backStampListEl = document.getElementById("backStampList");
      const flipCardBtn = document.getElementById("flipCardBtn");
      const prevCardBtn = document.getElementById("prevCardBtn");
      const nextCardBtn = document.getElementById("nextCardBtn");
      const closeModalBtn = document.getElementById("closeModalBtn");

      function renderPoolTabs() {
        poolTabsEl.textContent = "";
        const allTab = document.createElement("button");
        allTab.type = "button";
        allTab.className = "pool-tab";
        allTab.setAttribute("role", "tab");
        allTab.setAttribute("aria-selected", state.poolId === "all" ? "true" : "false");
        allTab.innerHTML =
          '<span>Semua Pool</span><span class="tab-count">' +
          BINDER.summary.uniqueOwnedCards +
          "/" +
          BINDER.summary.totalCatalogCards +
          "</span>";
        allTab.addEventListener("click", function () {
          state.poolId = "all";
          state.groupId = "all";
          state.spreadIndex = 0;
          renderPoolTabs();
          renderGroupOptions();
          renderSpread("flip");
        });
        poolTabsEl.appendChild(allTab);

        (BINDER.pools || []).forEach(function (pool) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pool-tab";
          btn.setAttribute("role", "tab");
          btn.setAttribute("aria-selected", state.poolId === pool.id ? "true" : "false");
          const labelSpan = document.createElement("span");
          labelSpan.textContent = pool.emoji + " " + pool.name;
          const countSpan = document.createElement("span");
          countSpan.className = "tab-count";
          countSpan.textContent = pool.ownedCards + "/" + pool.totalCards;
          btn.appendChild(labelSpan);
          btn.appendChild(countSpan);
          btn.addEventListener("click", function () {
            state.poolId = pool.id;
            state.groupId = "all";
            state.spreadIndex = 0;
            renderPoolTabs();
            renderGroupOptions();
            renderSpread("flip");
          });
          poolTabsEl.appendChild(btn);
        });
      }

      function renderGroupOptions() {
        groupSelectEl.textContent = "";
        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = "Semua Seri / Grup";
        groupSelectEl.appendChild(allOpt);

        (BINDER.groups || []).forEach(function (g) {
          if (state.poolId !== "all" && g.poolId !== state.poolId) return;
          const opt = document.createElement("option");
          opt.value = g.id;
          opt.textContent =
            g.badge + " · " + g.name + " (" + g.ownedCards + "/" + g.totalCards + ")";
          groupSelectEl.appendChild(opt);
        });
        groupSelectEl.value = state.groupId;
      }

      function getFilteredSlots() {
        const q = state.search.trim().toLowerCase();
        return (BINDER.slots || []).filter(function (slot) {
          if (state.poolId !== "all" && slot.poolId !== state.poolId) return false;
          if (state.groupId !== "all" && slot.groupId !== state.groupId) return false;
          if (state.rarity !== "all" && slot.rarity !== state.rarity) return false;
          if (state.mode === "owned" && !slot.owned) return false;
          if (state.mode === "missing" && slot.owned) return false;
          if (q !== "") {
            const nameMatch = (slot.memberName || "").toLowerCase().includes(q);
            const labelMatch = (slot.photoLabel || "").toLowerCase().includes(q);
            const serialMatch = ("#" + slot.serial).includes(q) || String(slot.serial) === q;
            if (!nameMatch && !labelMatch && !serialMatch) return false;
          }
          return true;
        });
      }

      function createPocketNode(slot) {
        const pocket = document.createElement("div");
        pocket.className = "pocket " + (slot.owned ? "owned" : "unowned");
        pocket.setAttribute("data-rarity", slot.rarity);

        if (slot.owned && slot.imageUrl) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pocket-card-btn";
          const displayTitle = slot.photoLabel || slot.memberName;
          btn.setAttribute(
            "aria-label",
            "Periksa kartu " +
              displayTitle +
              " (" +
              (BINDER.rarityLabels[slot.rarity] || slot.rarity) +
              ", No. " +
              slot.serial +
              ")",
          );

          const wrap = document.createElement("div");
          wrap.className = "card-img-wrap";

          const skel = document.createElement("div");
          skel.className = "img-skeleton";
          skel.textContent = "No. " + slot.serial;

          const img = document.createElement("img");
          img.className = "card-img";
          img.src = slot.imageUrl;
          img.alt = displayTitle + " · Foto " + slot.photoNo + "/" + slot.photoTotal;
          img.width = 400;
          img.height = 600;
          img.loading = "lazy";
          img.addEventListener("load", function () {
            img.classList.add("loaded");
            skel.remove();
          });
          img.addEventListener("error", function () {
            skel.textContent = "Gagal muat #" + slot.serial;
          });

          wrap.appendChild(skel);
          wrap.appendChild(img);
          btn.appendChild(wrap);

          const badges = document.createElement("div");
          badges.className = "pocket-badges";
          if (slot.totalCopies > 1) {
            const qty = document.createElement("span");
            qty.className = "badge-qty";
            qty.textContent = "×" + slot.totalCopies;
            badges.appendChild(qty);
          }
          if (slot.holoQty > 0 || slot.rarity === "holo" || slot.rarity === "secret") {
            const holo = document.createElement("span");
            holo.className = "badge-holo";
            holo.textContent =
              slot.holoQty > 0 ? "✦ ×" + slot.holoQty : "✦ " + (BINDER.rarityLabels[slot.rarity] || "Holo");
            badges.appendChild(holo);
          }
          pocket.appendChild(btn);
          pocket.appendChild(badges);

          btn.addEventListener("click", function () {
            openCardModal(slot.cardId);
          });
        } else {
          const empty = document.createElement("div");
          empty.className = "empty-sleeve";

          const serial = document.createElement("span");
          serial.className = "empty-serial";
          serial.textContent = "No. " + slot.serial;

          const emblem = document.createElement("div");
          emblem.className = "empty-emblem";
          emblem.textContent = slot.hiddenMystery
            ? "✦ ?"
            : BINDER.rarityStars[slot.rarity] || "★";

          const meta = document.createElement("div");
          meta.className = "empty-meta";
          const name = document.createElement("span");
          name.className = "empty-name";
          name.textContent = slot.photoLabel || slot.memberName;
          const photo = document.createElement("span");
          photo.className = "empty-photo";
          photo.textContent =
            "Foto " +
            slot.photoNo +
            "/" +
            slot.photoTotal +
            " · " +
            (BINDER.rarityLabels[slot.rarity] || slot.rarity);

          meta.appendChild(name);
          meta.appendChild(photo);
          empty.appendChild(serial);
          empty.appendChild(emblem);
          empty.appendChild(meta);
          pocket.appendChild(empty);
        }
        return pocket;
      }

      function renderSpread(animDirection) {
        const filtered = getFilteredSlots();
        const totalSpreads = Math.max(1, Math.ceil(filtered.length / POCKETS_PER_SPREAD));
        if (state.spreadIndex >= totalSpreads) state.spreadIndex = totalSpreads - 1;
        if (state.spreadIndex < 0) state.spreadIndex = 0;

        if (animDirection === "next" || animDirection === "prev" || animDirection === "flip") {
          playPaperSound("flip");
          bookSpreadEl.classList.remove("turning-next", "turning-prev");
          void bookSpreadEl.offsetWidth;
          bookSpreadEl.classList.add(
            animDirection === "prev" ? "turning-prev" : "turning-next",
          );
        }

        const startIdx = state.spreadIndex * POCKETS_PER_SPREAD;
        const spreadSlots = filtered.slice(startIdx, startIdx + POCKETS_PER_SPREAD);
        const leftSlots = spreadSlots.slice(0, POCKETS_PER_PAGE);
        const rightSlots = spreadSlots.slice(POCKETS_PER_PAGE, POCKETS_PER_SPREAD);

        const leftPageNumber = state.spreadIndex * 2 + 1;
        const rightPageNumber = leftPageNumber + 1;
        leftPageNumEl.textContent = "Hal. " + leftPageNumber;
        rightPageNumEl.textContent = "Hal. " + rightPageNumber;

        const activePool = poolById.get(state.poolId);
        const activeGroup = groupById.get(state.groupId);
        const scopeTitle = activeGroup
          ? activeGroup.badge + " · " + activeGroup.name
          : activePool
            ? activePool.emoji + " " + activePool.name
            : "Seluruh Katalog Binder";
        leftPageTitleEl.textContent = scopeTitle;
        rightPageTitleEl.textContent = scopeTitle;

        leftGridEl.textContent = "";
        rightGridEl.textContent = "";

        if (filtered.length === 0) {
          const emptyBox = document.createElement("div");
          emptyBox.className = "binder-empty-state";
          const h3 = document.createElement("h3");
          h3.textContent =
            BINDER.summary.uniqueOwnedCards === 0 && state.mode === "owned"
              ? "Belum Ada Photocard di Koleksimu"
              : "Tidak Ada Kantong Kartu yang Cocok";
          const p = document.createElement("p");
          p.textContent =
            BINDER.summary.uniqueOwnedCards === 0 && state.mode === "owned"
              ? "Kamu belum memiliki photocard. Gunakan command /gacha di Discord untuk menarik kartu pertamamu, atau klik Semua Slot untuk melihat siluet katalog."
              : "Coba ubah filter seri, rarity, atau kata kunci pencarian untuk melihat kantong kartu lainnya.";
          const resetBtn = document.createElement("button");
          resetBtn.type = "button";
          resetBtn.className = "tool-btn";
          resetBtn.textContent = "Tampilkan Semua Slot";
          resetBtn.addEventListener("click", function () {
            state.poolId = "all";
            state.groupId = "all";
            state.rarity = "all";
            state.mode = "all";
            state.search = "";
            raritySelectEl.value = "all";
            searchInputEl.value = "";
            document.querySelectorAll(".mode-btn").forEach(function (b) {
              b.setAttribute(
                "aria-pressed",
                b.getAttribute("data-mode") === "all" ? "true" : "false",
              );
            });
            renderPoolTabs();
            renderGroupOptions();
            renderSpread("flip");
          });
          emptyBox.appendChild(h3);
          emptyBox.appendChild(p);
          emptyBox.appendChild(resetBtn);
          leftGridEl.appendChild(emptyBox);
        } else {
          for (let i = 0; i < POCKETS_PER_PAGE; i++) {
            const slotL = leftSlots[i];
            if (slotL) {
              leftGridEl.appendChild(createPocketNode(slotL));
            }
            const slotR = rightSlots[i];
            if (slotR) {
              rightGridEl.appendChild(createPocketNode(slotR));
            }
          }
        }

        const ownedInFilter = filtered.filter((s) => s.owned).length;
        spreadStatusText.textContent =
          "Lembar " + (state.spreadIndex + 1) + " dari " + totalSpreads;
        spreadSubText.textContent =
          "Halaman " +
          leftPageNumber +
          "-" +
          rightPageNumber +
          " · " +
          ownedInFilter +
          " dimiliki dari " +
          filtered.length +
          " slot";

        prevSpreadBtn.disabled = state.spreadIndex <= 0;
        nextSpreadBtn.disabled = state.spreadIndex >= totalSpreads - 1;
      }

      function formatUnixDate(sec) {
        if (!sec) return "Tidak tercatat";
        return new Date(sec * 1000).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }

      function getOwnedFilteredSlots() {
        return getFilteredSlots().filter((s) => s.owned && s.imageUrl);
      }

      function openCardModal(cardId) {
        const ownedList = getOwnedFilteredSlots();
        const fallbackList = (BINDER.slots || []).filter((s) => s.owned && s.imageUrl);
        const list = ownedList.some((s) => s.cardId === cardId) ? ownedList : fallbackList;
        const idx = list.findIndex((s) => s.cardId === cardId);
        if (idx === -1) return;
        const slot = list[idx];
        state.activeCardId = slot.cardId;
        state.isFlipped = false;
        rigEl.classList.remove("is-flipped");
        rigEl.style.setProperty("--rx", "0deg");
        rigEl.style.setProperty("--ry", "0deg");

        playPaperSound("slide");

        const displayTitle = slot.photoLabel || slot.memberName;
        const pool = poolById.get(slot.poolId);
        const group = groupById.get(slot.groupId);

        inspectImgEl.src = slot.imageUrl;
        inspectImgEl.alt = displayTitle;
        inspectRarityPillEl.textContent =
          (BINDER.rarityStars[slot.rarity] || "★") +
          " " +
          (BINDER.rarityLabels[slot.rarity] || slot.rarity);
        inspectTitleEl.textContent = displayTitle;
        inspectSubtitleEl.textContent =
          (pool ? pool.emoji + " " + pool.name : slot.poolId) +
          " · " +
          (group ? group.badge + " (" + group.name + ")" : slot.groupId) +
          (slot.photoLabel ? " · " + slot.memberName : "");

        const metaItems = [
          ["Nomor Seri", "No. " + slot.serial],
          ["Urutan Foto", "Foto " + slot.photoNo + " / " + slot.photoTotal],
          ["Jumlah Lembar", "×" + slot.totalCopies + (slot.holoQty > 0 ? " (✦ Holo ×" + slot.holoQty + ")" : "")],
          ["Pertama Didapat", formatUnixDate(slot.firstObtainedAt)],
        ];
        inspectMetaGridEl.textContent = "";
        metaItems.forEach(function (pair) {
          const box = document.createElement("div");
          box.className = "meta-box";
          const lbl = document.createElement("div");
          lbl.className = "meta-label";
          lbl.textContent = pair[0];
          const val = document.createElement("div");
          val.className = "meta-val";
          val.textContent = pair[1];
          box.appendChild(lbl);
          box.appendChild(val);
          inspectMetaGridEl.appendChild(box);
        });

        backSerialEl.textContent = "No. " + slot.serial;
        backStampListEl.textContent = "";
        [
          ["Pemilik", BINDER.displayName],
          ["Member", slot.memberName],
          ["Seri", group ? group.name : slot.groupId],
          ["Cetakan Biasa", "×" + slot.quantity],
          ["Cetakan Holo", "✦ ×" + slot.holoQty],
          ["Pertama Ditarik", formatUnixDate(slot.firstObtainedAt)],
          ["Terakhir Ditarik", formatUnixDate(slot.lastObtainedAt)],
        ].forEach(function (row) {
          const line = document.createElement("div");
          line.className = "back-stamp-row";
          const k = document.createElement("span");
          k.textContent = row[0];
          const v = document.createElement("strong");
          v.textContent = row[1];
          line.appendChild(k);
          line.appendChild(v);
          backStampListEl.appendChild(line);
        });

        prevCardBtn.disabled = idx <= 0;
        nextCardBtn.disabled = idx >= list.length - 1;
        modalEl.hidden = false;
        closeModalBtn.focus();
      }

      function closeCardModal() {
        if (modalEl.hidden) return;
        modalEl.hidden = true;
        state.activeCardId = null;
      }

      function stepModalCard(delta) {
        if (!state.activeCardId) return;
        const list = getOwnedFilteredSlots();
        const idx = list.findIndex((s) => s.cardId === state.activeCardId);
        if (idx === -1) return;
        const target = list[idx + delta];
        if (target) openCardModal(target.cardId);
      }

      // 3D Tilt interaction on card rig
      rigEl.addEventListener("pointermove", function (e) {
        const rect = rigEl.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
        const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
        const ry = ((nx - 0.5) * 24).toFixed(2) + "deg";
        const rx = ((0.5 - ny) * 22).toFixed(2) + "deg";
        rigEl.style.setProperty("--rx", rx);
        rigEl.style.setProperty("--ry", ry);
        rigEl.style.setProperty("--gx", (nx * 100).toFixed(1) + "%");
        rigEl.style.setProperty("--gy", (ny * 100).toFixed(1) + "%");
        rigEl.style.setProperty("--glare-alpha", "0.65");
      });
      rigEl.addEventListener("pointerleave", function () {
        rigEl.style.setProperty("--rx", "0deg");
        rigEl.style.setProperty("--ry", "0deg");
        rigEl.style.setProperty("--glare-alpha", "0.3");
      });

      flipCardBtn.addEventListener("click", function () {
        state.isFlipped = !state.isFlipped;
        rigEl.classList.toggle("is-flipped", state.isFlipped);
        playPaperSound("slide");
      });
      prevCardBtn.addEventListener("click", function () {
        stepModalCard(-1);
      });
      nextCardBtn.addEventListener("click", function () {
        stepModalCard(1);
      });
      closeModalBtn.addEventListener("click", closeCardModal);
      modalEl.addEventListener("click", function (e) {
        if (e.target === modalEl) closeCardModal();
      });

      groupSelectEl.addEventListener("change", function () {
        state.groupId = groupSelectEl.value;
        state.spreadIndex = 0;
        renderSpread("flip");
      });
      raritySelectEl.addEventListener("change", function () {
        state.rarity = raritySelectEl.value;
        state.spreadIndex = 0;
        renderSpread("flip");
      });
      searchInputEl.addEventListener("input", function () {
        state.search = searchInputEl.value;
        state.spreadIndex = 0;
        renderSpread();
      });

      document.querySelectorAll(".mode-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.mode = btn.getAttribute("data-mode") || "all";
          state.spreadIndex = 0;
          document.querySelectorAll(".mode-btn").forEach(function (b) {
            b.setAttribute("aria-pressed", b === btn ? "true" : "false");
          });
          renderSpread("flip");
        });
      });

      prevSpreadBtn.addEventListener("click", function () {
        if (state.spreadIndex > 0) {
          state.spreadIndex -= 1;
          renderSpread("prev");
        }
      });
      nextSpreadBtn.addEventListener("click", function () {
        state.spreadIndex += 1;
        renderSpread("next");
      });

      soundToggleBtn.addEventListener("click", function () {
        state.soundEnabled = !state.soundEnabled;
        soundToggleBtn.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
        soundToggleBtn.textContent =
          "Suara Kertas: " + (state.soundEnabled ? "Aktif" : "Mati");
      });

      themeToggleBtn.addEventListener("click", function () {
        state.theme = state.theme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", state.theme);
        themeToggleBtn.textContent =
          "Tema: " + (state.theme === "dark" ? "Gelap" : "Terang");
      });

      // Keyboard navigation (Escape closes modal; Left/Right flips pages or cards)
      window.addEventListener("keydown", function (e) {
        if (!modalEl.hidden) {
          if (e.key === "Escape") {
            e.preventDefault();
            closeCardModal();
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            stepModalCard(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            stepModalCard(1);
          }
          return;
        }
        if (document.activeElement === searchInputEl) return;
        if (e.key === "ArrowLeft" && !prevSpreadBtn.disabled) {
          e.preventDefault();
          state.spreadIndex -= 1;
          renderSpread("prev");
        } else if (e.key === "ArrowRight" && !nextSpreadBtn.disabled) {
          e.preventDefault();
          state.spreadIndex += 1;
          renderSpread("next");
        }
      });

      // Touch swipe support on binder spread
      let touchStartX = null;
      bookSpreadEl.addEventListener(
        "touchstart",
        function (e) {
          if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
        },
        { passive: true },
      );
      bookSpreadEl.addEventListener(
        "touchend",
        function (e) {
          if (touchStartX === null || e.changedTouches.length === 0) return;
          const dx = e.changedTouches[0].clientX - touchStartX;
          touchStartX = null;
          if (Math.abs(dx) < 55) return;
          if (dx < 0 && !nextSpreadBtn.disabled) {
            state.spreadIndex += 1;
            renderSpread("next");
          } else if (dx > 0 && !prevSpreadBtn.disabled) {
            state.spreadIndex -= 1;
            renderSpread("prev");
          }
        },
        { passive: true },
      );

      renderPoolTabs();
      renderGroupOptions();
      renderSpread();
    })();
  </script>
</body>
</html>`;
}
