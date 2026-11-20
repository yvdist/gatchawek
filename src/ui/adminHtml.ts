/**
 * Pure HTML builders for the admin panel. No fetch, no db: `(args) => string`.
 * All DB/user values pass through escapeHtml.
 */

import type {
  AdminCardDetail,
  AdminCardKindFilter,
  AdminCardRow,
  AdminCounts,
  AdminPoolGroupOption,
  AdminQueueStatus,
} from "../db/queries/admin.js";
import type { QueueRow } from "../db/queries/inject.js";
import {
  RARITY_KEYS,
  RARITY_LABEL,
  RARITY_STARS,
} from "../domain/rarity.js";

export type AdminPage =
  | "login"
  | "dashboard"
  | "cards"
  | "card"
  | "inject"
  | "import";

const BASE =
  "https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css";

function localImageSrc(base: string, imageFile: string): string {
  // Mirrors cardImageUrl (src/ui/gachaEmbed.ts) without a cross-layer import.
  if (
    imageFile.startsWith("https://") ||
    imageFile.startsWith("http://")
  ) {
    return imageFile;
  }
  return `https://${base}/cards/${imageFile}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ADMIN_CSS = `:root{color-scheme:dark;--bg:#0b0e14;--surface:#12161f;--surface-2:#181e2a;--border:#232b3a;--text:#e8ecf3;--muted:#9aa4b5;--accent:#3b82f6;--accent-ink:#0b1220;--success:#22c55e;--warning:#f59e0b;--error:#ef4444;--radius:.75rem;--r-common:#9ca3af;--r-rare:#a855f7;--r-super:#f59e0b;--r-ultra:#ec4899;--r-holo:#ffd700;--r-secret:#22d3ee}*,*::before,*::after{box-sizing:border-box}body{background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}h1,h2,h3{letter-spacing:-.02em}a{color:var(--accent)}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.topbar{background:var(--surface);border-bottom:1px solid var(--border)}.topbar-inner{max-width:1120px;margin:0 auto;padding:.7rem 20px;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.brand{display:inline-flex;align-items:center;gap:.45rem;font-weight:700;color:var(--text);margin-right:.5rem}.brand svg{width:16px;height:16px}.navlink{display:inline-block;padding:.4rem .8rem;border-radius:999px;color:var(--muted);text-decoration:none;font-size:.9rem}.navlink:hover{color:var(--text);background:rgba(59,130,246,.08)}.navlink.is-active{background:rgba(59,130,246,.14);color:#fff}.topbar .sp{flex:1}.wrap{max-width:1120px;margin:0 auto;padding:24px 20px 64px}.foot{color:var(--muted);font-size:12px;max-width:1120px;margin:0 auto;padding:0 20px 32px}.pagehead{margin:0 0 1.1rem}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.pagehead h1{font-size:clamp(24px,3vw,32px);margin:.25rem 0 .5rem}.lede{color:var(--muted);max-width:65ch;margin:.25rem 0 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem}.card h2,.card h3{margin-top:0}.tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}table{width:100%;border-collapse:collapse;margin-bottom:0}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);position:sticky;top:0;background:var(--surface);text-align:left;padding:.6rem .7rem;border-bottom:1px solid var(--border)}td{padding:.55rem .7rem;border-bottom:1px solid var(--border);vertical-align:middle}tr:last-child td{border-bottom:none}table img{width:48px;height:48px;border-radius:.5rem;object-fit:cover}.badge{display:inline-flex;align-items:center;gap:.35rem;padding:.15rem .55rem;border-radius:999px;font-size:.78rem;border:1px solid var(--border);background:var(--surface-2);color:var(--text);white-space:nowrap}.badge i{width:8px;height:8px;border-radius:50%;background:var(--r-common);display:inline-block}.b-empty{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.4)}.b-remote{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4)}.b-static{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.4)}.b-off{background:var(--surface-2);color:var(--muted)}.r-common i{background:var(--r-common)}.r-rare i{background:var(--r-rare)}.r-super_rare i{background:var(--r-super)}.r-ultra_rare i{background:var(--r-ultra)}.r-holo i{background:var(--r-holo)}.r-secret i{background:var(--r-secret)}.thumb-broken{border:2px solid var(--error)}.btn{display:inline-block;background:var(--accent);color:#fff;border:1px solid transparent;border-radius:.6rem;padding:.55rem 1rem;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .12s ease,background .12s ease}.btn:hover{background:#2f6fed;color:#fff;transform:translateY(-1px)}.btn:active{transform:translateY(0)}.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}.btn-ghost{display:inline-block;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:.6rem;padding:.55rem 1rem;text-decoration:none;cursor:pointer}.btn-ghost:hover{border-color:var(--accent);color:#fff}.btn-danger-outline{display:inline-block;background:transparent;color:var(--error);border:1px solid var(--error);border-radius:.6rem;padding:.55rem 1rem;cursor:pointer}.alert{padding:.6rem .8rem;border-radius:.6rem;border:1px solid var(--border);background:var(--surface-2)}.alert.is-ok{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.1)}.alert.is-err{border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.1)}.alert.is-info{border-color:rgba(59,130,246,.5);background:rgba(59,130,246,.1)}.field{display:grid;gap:.3rem;margin-bottom:.8rem}.field label{font-size:13px;color:var(--muted)}input[type=text],input[type=search],input[type=password],input[type=url],select{background:var(--surface-2);border:1px solid var(--border);border-radius:.6rem;padding:.55rem .7rem;color:var(--text);max-width:100%}input:focus,select:focus{border-color:var(--accent)}.import-table input,.import-table select{margin-bottom:0;min-width:130px}.tabs{display:inline-flex;gap:2px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:3px;flex-wrap:wrap}.tabs a{padding:.35rem .85rem;border-radius:999px;color:var(--muted);text-decoration:none;font-size:.88rem}.tabs a.is-active{background:var(--accent);color:#fff}.toolbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem}.toolbar form[role=search]{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:0}.statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem;margin-bottom:1rem}.stat{display:flex;flex-direction:column;gap:.15rem}.stat-label{font-size:13px;color:var(--muted)}.stat-num{font-size:30px;font-weight:700;line-height:1.1}.stat-link{font-size:.88rem}.backlink{display:inline-block;margin-bottom:1rem;color:var(--muted);text-decoration:none}.backlink:hover{color:var(--text)}label.btn{cursor:pointer}.detail{display:grid;grid-template-columns:340px 1fr;gap:1rem;margin-bottom:1rem}.preview img{max-width:100%;border-radius:.5rem;border:1px solid var(--border)}.kv{display:grid;grid-template-columns:auto 1fr;gap:.35rem .9rem;margin:0}.kv dt{font-size:13px;color:var(--muted)}.kv dd{margin:0}.guide ol{margin:.4rem 0 .6rem;padding-left:1.2rem;display:grid;gap:.4rem}.chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem}.chips code{font-size:.8rem}.dropzone{border:1.5px dashed #33405a;border-radius:var(--radius);padding:2rem 1rem;text-align:center;cursor:pointer;transition:background .15s ease,border-color .15s ease;margin-bottom:1rem;background:var(--surface-2)}.dropzone.is-dragover{border-color:var(--accent);background:rgba(59,130,246,.08)}.dropzone svg{width:28px;height:28px;color:var(--muted)}.file-hidden{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}.hint{font-size:.82rem;color:var(--muted)}.import-thumb{width:64px;height:64px;object-fit:cover;border-radius:.35rem}.status-ok{color:var(--success)}.status-err{color:var(--error)}.status-wait{color:var(--warning)}.actionbar{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--border);padding:.7rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.loginwrap{min-height:100vh;display:grid;place-items:center;padding:1rem}.login{width:min(26rem,92vw)}.login .btn{width:100%}@media (max-width:860px){.statgrid{grid-template-columns:repeat(2,1fr)}.detail{grid-template-columns:1fr}}@media (max-width:640px){.col-owned{display:none}}@media (max-width:520px){.statgrid{grid-template-columns:1fr}}@media (prefers-reduced-motion:reduce){*{transition:none!important}}`;

function shell(title: string, active: AdminPage, body: string): string {
  const link = (href: string, label: string, on: boolean): string =>
    `<a class="navlink${on ? " is-active" : ""}" href="${href}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · admin</title><link rel="stylesheet" href="${BASE}"><style>${ADMIN_CSS}</style></head><body><nav class="topbar"><div class="topbar-inner"><span class="brand"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10.7 2.3a2.6 2.6 0 0 0-3.4 3.4L2.6 10.4l3 3 4.7-4.7a2.6 2.6 0 0 0 3.4-3.4l-2 2-1.4-1.4 2-2.6z"/></svg>Admin</span>${link("/admin", "dashboard", active === "dashboard")}${link("/admin/cards", "kartu", active === "cards" || active === "card")}${link("/admin/inject", "inject", active === "inject")}${link("/admin/import", "import", active === "import")}<span class="sp"></span><form method="post" action="/admin/logout"><button type="submit" class="btn-ghost">logout</button></form></div></nav><main class="wrap">${body}</main><footer class="foot">Admin panel · internal</footer></body></html>`;
}

export function loginPage(error: string | null): string {
  const err = error === null ? "" : `<p class="alert is-err" role="alert">${escapeHtml(error)}</p>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>login · admin</title><link rel="stylesheet" href="${BASE}"><style>${ADMIN_CSS}</style></head><body><main class="loginwrap"><div class="card login"><span class="brand">Admin</span><div class="pagehead"><h1>Masuk</h1><p class="lede">Panel internal — butuh password owner.</p></div>${err}<form method="post" action="/admin/login"><div class="field"><label for="loginPw">password</label><input id="loginPw" type="password" name="password" required autocomplete="current-password"></div><button class="btn" type="submit">Masuk</button></form></div></main></body></html>`;
}

export function dashboardPage(counts: AdminCounts): string {
  const stat = (label: string, value: number, href: string | null, linkLabel: string): string =>
    `<article class="card stat"><span class="stat-label">${label}</span><span class="stat-num">${value}</span>${href === null ? "" : `<a class="stat-link" href="${href}">${linkLabel}</a>`}</article>`;
  return shell(
    "dashboard",
    "dashboard",
    `<div class="pagehead"><span class="eyebrow">Admin · Dashboard</span><h1>Dashboard</h1><p class="lede">Ringkasan katalog kartu dan antrean inject.</p></div><div class="statgrid">${stat("total kartu", counts.total, null, "")}${stat("image kosong", counts.empty, "/admin/cards?kind=empty", "Lihat →")}${stat("image remote/CDN", counts.remote, "/admin/cards?kind=remote", "Lihat →")}${stat("inject pending", counts.pending, "/admin/inject?status=pending", "Review →")}</div><p><a class="btn" href="/admin/import">Import kartu baru →</a></p>`,
  );
}

function kindBadge(kind: string): string {
  const cls = kind === "empty" ? "b-empty" : kind === "remote" ? "b-remote" : "b-static";
  return `<span class="badge ${cls}">${escapeHtml(kind)}</span>`;
}
function rarityBadge(key: string): string {
  const known = (RARITY_KEYS as readonly string[]).includes(key);
  const cls = known ? `r-${key}` : "r-common";
  const k = known ? (key as (typeof RARITY_KEYS)[number]) : "common";
  return `<span class="badge ${cls}"><i></i>${escapeHtml(`${RARITY_STARS[k]} ${RARITY_LABEL[k]}`)}</span>`;
}

const KINDS: AdminCardKindFilter[] = ["all", "empty", "remote", "static"];

export function cardsPage(args: {
  rows: AdminCardRow[];
  total: number;
  kind: AdminCardKindFilter;
  q: string;
  base: string;
  renderMessage?: string | null;
  renderOk?: boolean;
}): string {
  const tabs = KINDS.map(
    (k) =>
      `<a class="${k === args.kind ? "is-active" : ""}" href="/admin/cards?kind=${k}${args.q === "" ? "" : `&amp;q=${encodeURIComponent(args.q)}`}">${k}</a>`,
  ).join("");
  const rows = args.rows
    .map((r) => {
      const thumb =
        r.imageKind === "empty"
          ? `<span class="badge b-empty">tanpa image</span>`
          : `<img src="${escapeHtml(localImageSrc(args.base, r.imageFile))}" alt="" loading="lazy" onerror="this.classList.add('thumb-broken');var b=this.nextElementSibling;if(b)b.hidden=false;"><span class="badge b-off" hidden>gagal dimuat</span>`;
      const pick =
        r.imageKind === "remote" && r.enabled
          ? `<input type="checkbox" name="ids" value="${escapeHtml(r.id)}" aria-label="pilih ${escapeHtml(r.id)}">`
          : "";
      return `<tr><td>${pick}</td><td>${thumb}</td><td><a href="/admin/cards/${escapeHtml(r.id)}">${escapeHtml(r.id)}</a></td><td>${escapeHtml(r.memberName)}</td><td>${escapeHtml(r.poolName)} · ${escapeHtml(r.groupBadge)}</td><td>${rarityBadge(r.rarity)}</td><td>${kindBadge(r.imageKind)}</td><td class="col-owned">×${r.quantityOwned}</td><td>${r.enabled ? "aktif" : `<span class="badge b-off">mati</span>`}</td></tr>`;
    })
    .join("");
  const banner =
    args.renderMessage !== undefined &&
    args.renderMessage !== null &&
    args.renderMessage !== ""
      ? `<p class="alert ${args.renderOk === true ? "is-ok" : args.renderOk === false ? "is-err" : "is-info"}" role="alert">${escapeHtml(args.renderMessage)}</p>`
      : "";
  const inRemoteTab = args.kind === "remote";
  const bulkOpen = inRemoteTab
    ? `<form id="renderForm" method="post" action="/admin/cards/render-remote">`
    : "";
  const bulkClose = inRemoteTab
    ? `<div class="actionbar"><label class="hint"><input type="checkbox" id="pickAll"> semua</label><button type="submit" id="renderBtn" class="btn" disabled>Minta render (0)</button><span class="hint">Render bingkai di cloud (cron 15 mnt / tombol). Butuh GitHub PAT untuk tombol.</span></div></form><script>(function(){var btn=document.getElementById("renderBtn");var all=document.getElementById("pickAll");if(!btn)return;function boxes(){return Array.prototype.slice.call(document.querySelectorAll('input[name="ids"]'));}function sync(){var bs=boxes();var n=bs.filter(function(b){return b.checked;}).length;btn.disabled=n===0;btn.textContent="Minta render ("+n+")";if(all)all.checked=n>0&&bs.every(function(b){return b.checked;});}if(all)all.addEventListener("change",function(){boxes().forEach(function(b){b.checked=all.checked;});sync();});document.addEventListener("change",function(e){if(e.target&&e.target.name==="ids")sync();});sync();})();</script>`
    : "";
  return shell(
    "kartu",
    "cards",
    `<div class="pagehead"><span class="eyebrow">Admin · Kartu</span><h1>Kartu (${args.total})</h1><p class="lede">Cari dan kelola katalog kartu.</p></div>${banner}<div class="toolbar"><nav class="tabs" aria-label="Filter kind">${tabs}</nav><form method="get" action="/admin/cards" role="search"><input type="hidden" name="kind" value="${escapeHtml(args.kind)}"><input type="search" name="q" value="${escapeHtml(args.q)}" placeholder="cari nama / id kartu"><button class="btn-ghost" type="submit">Cari</button></form></div>${bulkOpen}<div class="tablewrap"><table><thead><tr><th></th><th>thumb</th><th>id</th><th>member</th><th>pool · grup</th><th>rarity</th><th>kind</th><th class="col-owned">owned</th><th>status</th></tr></thead><tbody>${rows === "" ? `<tr><td colspan="9">kosong.</td></tr>` : rows}</tbody></table></div>${bulkClose}`,
  );
}

export function cardDetailPage(args: {
  card: AdminCardDetail;
  base: string;
  message: string | null;
  ok: boolean;
}): string {
  const c = args.card;
  const img =
    c.imageKind === "empty"
      ? `<p><span class="badge b-empty">tanpa image</span></p>`
      : `<img src="${escapeHtml(localImageSrc(args.base, c.imageFile))}" alt="" onerror="this.classList.add('thumb-broken');var b=document.getElementById('imgwarn');if(b)b.hidden=false;"><p id="imgwarn" hidden><span class="badge b-off">gagal dimuat — file static hilang atau URL mati</span></p>`;
  const rawBanner =
    c.imageKind === "remote"
      ? `<p><span class="badge b-remote">image raw/CDN — rebuild pipeline (fetch-images → build-cards → seed → deploy) agar permanen</span></p>`
      : "";
  const msg =
    args.message === null
      ? ""
      : `<p class="alert ${args.ok ? "is-ok" : "is-err"}" role="alert">${escapeHtml(args.message)}</p>`;
  return shell(
    c.id,
    "card",
    `<a class="backlink" href="/admin/cards">← Kembali ke daftar</a><div class="pagehead"><span class="eyebrow">Admin · Kartu</span><h1>${escapeHtml(c.id)}</h1></div>${msg}<div class="detail"><div class="card preview">${img}${rawBanner}<p><code>${escapeHtml(c.imageFile)}</code></p></div><div class="card meta"><dl class="kv"><dt>member</dt><dd>${escapeHtml(c.memberName)}${c.fullName === null ? "" : ` (${escapeHtml(c.fullName)})`}</dd><dt>pool · grup</dt><dd>${escapeHtml(c.poolName)} · ${escapeHtml(c.groupBadge)}</dd><dt>rarity</dt><dd>${rarityBadge(c.rarity)}</dd><dt>foto</dt><dd>${c.photoNo}/${c.photoTotal}${c.photoLabel === null ? "" : ` · ${escapeHtml(c.photoLabel)}`}</dd><dt>serial</dt><dd>${c.serial}</dd><dt>owned</dt><dd>×${c.quantityOwned}</dd><dt>holo</dt><dd>${c.holoEnabled ? "ya" : "tidak"}</dd><dt>sumber</dt><dd>${c.sourcePageUrl === null ? "—" : escapeHtml(c.sourcePageUrl)}</dd><dt>kind</dt><dd>${kindBadge(c.imageKind)}</dd><dt>status</dt><dd>${c.enabled ? "aktif" : "mati"}</dd></dl></div></div><div class="card"><h2>Ganti image</h2><form method="post" action="/admin/cards/${escapeHtml(c.id)}/image" enctype="multipart/form-data"><div class="field"><label for="imgFile">upload file (≤8 MB)</label><input id="imgFile" type="file" name="file" accept="image/*" required></div><button class="btn" type="submit">upload via discord</button></form><form method="post" action="/admin/cards/${escapeHtml(c.id)}/image"><div class="field"><label for="imgUrl">atau set URL manual (https)</label><input id="imgUrl" type="url" name="url" placeholder="https://…" required></div><button class="btn" type="submit">set URL</button></form><h2>Status</h2><form method="post" action="/admin/cards/${escapeHtml(c.id)}/enabled"><input type="hidden" name="enabled" value="${c.enabled ? "0" : "1"}"><button class="btn-ghost" type="submit">${c.enabled ? "nonaktifkan" : "aktifkan"}</button></form></div>`,
  );
}

const STATUSES: AdminQueueStatus[] = ["pending", "approved", "rejected"];

export function injectPage(args: {
  rows: QueueRow[];
  total: number;
  status: AdminQueueStatus;
  ok: string | null;
}): string {
  const tabs = STATUSES.map(
    (s) => `<a class="${s === args.status ? "is-active" : ""}" href="/admin/inject?status=${s}">${s}</a>`,
  ).join("");
  const ok = args.ok === null ? "" : `<p class="alert is-ok" role="alert">${escapeHtml(args.ok)}</p>`;
  const rows = args.rows
    .map((r) => {
      const preview =
        r.imageUrl === null || r.imageUrl === ""
          ? `<span class="badge b-empty">tanpa image</span>`
          : `<a href="${escapeHtml(r.messageUrl)}"><img src="${escapeHtml(r.imageUrl)}" alt="" loading="lazy" onerror="this.classList.add('thumb-broken');var b=this.nextElementSibling;if(b)b.hidden=false;"><span class="badge b-off" hidden>gagal dimuat</span></a>`;
      const action =
        r.status === "pending"
          ? `<form method="post" action="/admin/inject/${escapeHtml(r.messageId)}/approve" onsubmit="return confirm('Approve ${escapeHtml(r.nama ?? r.messageId)}?')"><button class="btn" type="submit">approve</button></form><form method="post" action="/admin/inject/${escapeHtml(r.messageId)}/reject" onsubmit="return confirm('Reject ${escapeHtml(r.messageId)}?')"><button type="submit" class="btn-danger-outline">reject</button></form>`
          : escapeHtml(r.status);
      return `<tr><td>${preview}</td><td>${escapeHtml(r.nama ?? "—")}<br><small>${escapeHtml(r.messageId)}</small></td><td>${escapeHtml(r.pool ?? "—")} · ${escapeHtml(r.grup ?? "—")}</td><td>${escapeHtml(r.rarity ?? "—")}</td><td>${r.errors === null || r.errors === "" ? "—" : escapeHtml(r.errors)}</td><td><a href="${escapeHtml(r.messageUrl)}">pesan</a></td><td>${action}</td></tr>`;
    })
    .join("");
  return shell(
    "inject",
    "inject",
    `<div class="pagehead"><span class="eyebrow">Admin · Inject</span><h1>Inject ${escapeHtml(args.status)} (${args.total})</h1></div><div class="toolbar"><nav class="tabs" aria-label="Filter status">${tabs}</nav></div>${ok}<div class="tablewrap"><table><thead><tr><th>preview</th><th>nama</th><th>pool · grup</th><th>rarity</th><th>errors</th><th>link</th><th>aksi</th></tr></thead><tbody>${rows === "" ? `<tr><td colspan="7">kosong.</td></tr>` : rows}</tbody></table></div><p class="lede">Approve/reject via web memakai logika yang sama dengan tombol Discord.</p>`,
  );
}

export interface ImportBatchItemResult {
  filename: string;
  ok: boolean;
  message: string;
  cardId?: string;
  serial?: number;
}

function buildImportScript(): string {
  const rarityOptions = JSON.stringify(
    RARITY_KEYS.map((key) => ({
      key,
      label: `${RARITY_STARS[key]} ${RARITY_LABEL[key]}`,
    })),
  ).replace(/</g, "\\u003c");
  return `<script>
(function(){
  var RARITY_OPTIONS=${rarityOptions};
  var ALIAS_MAP={
    common:"common",c:"common","1":"common","\\u2605":"common","*":"common",bintang_1:"common",
    rare:"rare",r:"rare","2":"rare","\\u2605\\u2605":"rare","**":"rare",bintang_2:"rare",
    super_rare:"super_rare",sr:"super_rare","3":"super_rare","\\u2605\\u2605\\u2605":"super_rare","***":"super_rare",bintang_3:"super_rare",
    ultra_rare:"ultra_rare",ur:"ultra_rare","4":"ultra_rare","\\u2605\\u2605\\u2605\\u2605":"ultra_rare","****":"ultra_rare",bintang_4:"ultra_rare",
    holo:"holo",h:"holo",holographic:"holo",ssr:"holo","5":"holo","\\u2605\\u2605\\u2605\\u2605\\u2605":"holo","*****":"holo",bintang_5:"holo",
    secret:"secret",s:"secret",scr:"secret","6":"secret",bintang_6:"secret","\\u2605\\u2605\\u2605\\u2605\\u2605\\u2605":"secret","******":"secret"
  };
  var TEMPLATE_RE=/^\\s*[\\(\\[]\\s*([^\\)\\]]+?)\\s*[\\)\\]]\\s*(?:[-\\u2013\\u2014_:]+\\s*|\\s+)(.+?)\\s*$/;
  function parseAlias(raw){
    var k=String(raw||"").trim().toLowerCase().replace(/[\\s-]+/g,"_");
    return k&&ALIAS_MAP[k]?ALIAS_MAP[k]:null;
  }
  function toTitleCase(raw){
    var c=String(raw||"").replace(/[_-]+/g," ").replace(/\\s+/g," ").trim();
    if(!c)return"";
    return c.split(" ").map(function(w){return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();}).join(" ");
  }
  function splitGroupAndName(rest){
    var parts=String(rest||"").split(/\\s+[-\\u2013\\u2014:]+\\s+/).map(function(p){return p.trim();}).filter(function(p){return p!=="";});
    if(parts.length>=2){return{group:parts[0],name:parts.slice(1).join(" - ")};}
    return{group:null,name:String(rest||"").trim()};
  }
  function parseFilename(name){
    var base=String(name||"").split(/[/\\\\]/).pop()||name;
    var stem=base.replace(/\\.[^.]+$/,"");
    var m=TEMPLATE_RE.exec(stem);
    if(m){
      var rawR=m[1].trim();
      var r=parseAlias(rawR);
      var split=splitGroupAndName(m[2]);
      var nama=toTitleCase(split.name);
      var rawG=split.group;
      return{nama:nama,rarity:r,rawRarity:rawR,group:rawG?toTitleCase(rawG):null,rawGroup:rawG,matched:Boolean(r&&nama)};
    }
    return{nama:toTitleCase(stem),rarity:null,rawRarity:null,group:null,rawGroup:null,matched:false};
  }
  var form=document.getElementById("importForm");
  var dropzone=document.getElementById("dropzone");
  var fileInput=document.getElementById("fileInput");
  var poolGroupEl=document.getElementById("poolGroup");
  var previewWrap=document.getElementById("previewWrap");
  var previewBody=document.getElementById("previewBody");
  var submitBtn=document.getElementById("submitBtn");
  var clearBtn=document.getElementById("clearBtn");
  var summaryEl=document.getElementById("summaryText");
  if(!form||!dropzone||!fileInput||!previewWrap||!previewBody)return;
  var queue=[];
  var seq=0;
  function render(){
    previewBody.textContent="";
    previewWrap.hidden=queue.length===0;
    queue.forEach(function(item){
      var tr=document.createElement("tr");
      var tdThumb=document.createElement("td");
      if(item.objectUrl){
        var img=document.createElement("img");
        img.src=item.objectUrl;
        img.alt="";
        img.className="import-thumb";
        tdThumb.appendChild(img);
      }else{
        tdThumb.textContent="—";
      }
      var tdFile=document.createElement("td");
      var code=document.createElement("code");
      code.textContent=item.file.name;
      tdFile.appendChild(code);

      var tdNama=document.createElement("td");
      var inpNama=document.createElement("input");
      inpNama.type="text";
      inpNama.value=item.nama;
      inpNama.required=true;
      inpNama.disabled=item.imported;
      inpNama.addEventListener("input",function(){item.nama=inpNama.value;});
      tdNama.appendChild(inpNama);

      var tdRarity=document.createElement("td");
      var sel=document.createElement("select");
      sel.disabled=item.imported;
      RARITY_OPTIONS.forEach(function(opt){
        var o=document.createElement("option");
        o.value=opt.key;
        o.textContent=opt.label;
        if(opt.key===item.rarity)o.selected=true;
        sel.appendChild(o);
      });
      sel.addEventListener("change",function(){item.rarity=sel.value;});
      tdRarity.appendChild(sel);

      var tdLabel=document.createElement("td");
      var inpLabel=document.createElement("input");
      inpLabel.type="text";
      inpLabel.maxLength=60;
      inpLabel.placeholder="opsional";
      inpLabel.value=item.label;
      inpLabel.disabled=item.imported;
      inpLabel.addEventListener("input",function(){item.label=inpLabel.value;});
      tdLabel.appendChild(inpLabel);

      var tdStatus=document.createElement("td");
      var span=document.createElement("span");
      span.className=item.statusKind==="ok"?"status-ok":item.statusKind==="err"?"status-err":"status-wait";
      span.textContent=item.status;
      tdStatus.appendChild(span);
      item.statusNode=span;

      var tdAct=document.createElement("td");
      var rm=document.createElement("button");
      rm.type="button";
      rm.className="btn-ghost";
      rm.textContent="Hapus";
      rm.addEventListener("click",function(){
        if(item.objectUrl)URL.revokeObjectURL(item.objectUrl);
        queue=queue.filter(function(x){return x.id!==item.id;});
        render();
      });
      tdAct.appendChild(rm);

      tr.appendChild(tdThumb);
      tr.appendChild(tdFile);
      tr.appendChild(tdNama);
      tr.appendChild(tdRarity);
      tr.appendChild(tdLabel);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAct);
      previewBody.appendChild(tr);
    });
  }
  function addFiles(list){
    for(var i=0;i<list.length;i++){
      var f=list[i];
      if(!f)continue;
      var parsed=parseFilename(f.name);
      var isImg=f.type&&f.type.indexOf("image/")===0;
      var tooBig=f.size>8000000;
      var status=parsed.matched?"\\u2705 Template cocok":(parsed.rawRarity?"\\u26a0\\ufe0f Rarity tak dikenal ("+parsed.rawRarity+")":"\\u26a0\\ufe0f Pilih rarity manual");
      var kind=parsed.matched?"ok":"wait";
      if(!isImg){status="\\u274c Bukan gambar";kind="err";}
      else if(tooBig){status="\\u274c Melebihi 8 MB";kind="err";}
      queue.push({
        id:++seq,
        file:f,
        objectUrl:isImg?URL.createObjectURL(f):"",
        nama:parsed.nama,
        rarity:parsed.rarity||"common",
        label:"",
        status:status,
        statusKind:kind,
        imported:false,
        valid:isImg&&!tooBig,
        statusNode:null
      });
    }
    render();
  }
  dropzone.addEventListener("click",function(e){if(e.target!==fileInput)fileInput.click();});
  dropzone.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();fileInput.click();}});
  fileInput.addEventListener("change",function(){if(fileInput.files&&fileInput.files.length>0){addFiles(fileInput.files);fileInput.value="";}});
  ["dragenter","dragover"].forEach(function(ev){
    dropzone.addEventListener(ev,function(e){e.preventDefault();dropzone.classList.add("is-dragover");});
  });
  ["dragleave","drop"].forEach(function(ev){
    dropzone.addEventListener(ev,function(e){e.preventDefault();dropzone.classList.remove("is-dragover");});
  });
  dropzone.addEventListener("drop",function(e){
    if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length>0){addFiles(e.dataTransfer.files);}
  });
  clearBtn.addEventListener("click",function(){
    queue.forEach(function(item){if(item.objectUrl)URL.revokeObjectURL(item.objectUrl);});
    queue=[];
    summaryEl.textContent="";
    render();
  });
  form.addEventListener("submit",async function(e){
    e.preventDefault();
    if(queue.length===0)return;
    var pg=poolGroupEl?poolGroupEl.value:"";
    if(!pg)return;
    submitBtn.disabled=true;
    clearBtn.disabled=true;
    var okCount=0;
    var failCount=0;
    for(var i=0;i<queue.length;i++){
      var item=queue[i];
      if(item.imported){okCount++;continue;}
      if(!item.valid||!item.nama.trim()){
        item.status="\\u274c Periksa file / nama kartu";
        item.statusKind="err";
        if(item.statusNode){item.statusNode.className="status-err";item.statusNode.textContent=item.status;}
        failCount++;
        continue;
      }
      item.status="\\u23f3 Mengupload...";
      item.statusKind="wait";
      if(item.statusNode){item.statusNode.className="status-wait";item.statusNode.textContent=item.status;}
      try{
        var fd=new FormData();
        fd.set("poolGroup",pg);
        fd.set("files",item.file,item.file.name);
        fd.set("nama",item.nama.trim());
        fd.set("rarity",item.rarity);
        fd.set("label",item.label.trim());
        var res=await fetch("/admin/import",{method:"POST",headers:{Accept:"application/json"},body:fd});
        var data=await res.json();
        var r=data&&data.results&&data.results[0]?data.results[0]:null;
        if(res.ok&&r&&r.ok){
          item.imported=true;
          item.status="\\u2705 "+r.message;
          item.statusKind="ok";
          okCount++;
        }else{
          item.status="\\u274c "+((r&&r.message)||data.error||("HTTP "+res.status));
          item.statusKind="err";
          failCount++;
        }
      }catch(err){
        item.status="\\u274c Gagal jaringan";
        item.statusKind="err";
        failCount++;
      }
      if(item.statusNode){
        item.statusNode.className=item.statusKind==="ok"?"status-ok":"status-err";
        item.statusNode.textContent=item.status;
      }
    }
    summaryEl.textContent="Selesai: "+okCount+" berhasil, "+failCount+" gagal.";
    submitBtn.disabled=false;
    clearBtn.disabled=false;
  });
})();
</script>`;
}

export function importPage(args: {
  poolGroups: AdminPoolGroupOption[];
  results?: ImportBatchItemResult[];
  error?: string | null;
}): string {
  const errBanner =
    args.error !== undefined && args.error !== null && args.error !== ""
      ? `<p class="alert is-err" role="alert">${escapeHtml(args.error)}</p>`
      : "";
  const resultsBlock =
    args.results !== undefined && args.results.length > 0
      ? `<div class="card"><h2>Hasil Import (${String(args.results.length)})</h2><ul>${args.results
          .map(
            (r) =>
              `<li>${r.ok ? "✅" : "❌"} <strong>${escapeHtml(r.filename)}</strong> — ${escapeHtml(r.message)}</li>`,
          )
          .join("")}</ul></div>`
      : "";
  const poolOptions = args.poolGroups
    .map(
      (pg) =>
        `<option value="${escapeHtml(`${pg.poolId}:${pg.groupId}`)}">${escapeHtml(`${pg.poolEmoji} ${pg.poolName} · ${pg.groupName} (${pg.groupBadge})`)}</option>`,
    )
    .join("");
  const noPoolsWarn =
    args.poolGroups.length === 0
      ? `<p class="alert is-err" role="alert">Belum ada pool/grup aktif di database.</p>`
      : "";
  const body = `<div class="pagehead"><span class="eyebrow">Admin · Import</span><h1>Import kartu</h1><p class="lede">Seret gambar, periksa hasil parse nama file, lalu import ke katalog.</p></div>${errBanner}${resultsBlock}${noPoolsWarn}<section class="card guide"><h2>Panduan nama file</h2><ol><li><strong>Beri nama file</strong> dengan pola <code>(rarity) - nama grup - nama kartu.ext</code></li><li><strong>Contoh:</strong> <code>(secret) - Jomok - Refi Kaget.jpg</code> → Rarity: <strong>★★★★★★ Secret</strong>, Grup: <strong>Jomok</strong>, Nama Kartu: <strong>Refi Kaget</strong> (Auto Title Case).</li><li><strong>Grup opsional:</strong> <code>(holo) - refi kaget.jpg</code> ikut target dropdown di bawah, dengan rarity <strong>★★★★★ Holo</strong>. Kode <code>(secret)</code> setara secret.</li></ol><div class="chips"><code>common (c/1)</code><code>rare (r/2)</code><code>super rare (sr/3)</code><code>ultra rare (ur/4)</code><code>holo (h/5)</code><code>secret (s/6)</code></div></section><form id="importForm" method="post" action="/admin/import" enctype="multipart/form-data"><div class="field"><label for="poolGroup">Target pool · grup</label><select id="poolGroup" name="poolGroup" required>${poolOptions}</select></div><div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Seret dan lepas gambar ke sini atau klik untuk memilih file"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><p><strong>Seret &amp; letakkan gambar di sini</strong></p><p>atau</p><p><label class="btn" for="fileInput">Pilih file</label></p><p class="hint">JPG, PNG, WebP · maks 8 MB/file</p><input type="file" id="fileInput" class="file-hidden" name="files" accept="image/*" multiple></div><div id="previewWrap" hidden><div class="tablewrap"><table class="import-table"><thead><tr><th>preview</th><th>file</th><th>nama kartu</th><th>rarity</th><th>label (opsional)</th><th>status</th><th></th></tr></thead><tbody id="previewBody"></tbody></table></div><div class="actionbar"><button type="submit" id="submitBtn"${args.poolGroups.length === 0 ? " disabled" : ""} class="btn">Import ke Katalog</button><button type="button" id="clearBtn" class="btn-ghost">Bersihkan Daftar</button><span id="summaryText" class="hint"></span></div></div></form>${buildImportScript()}`;
  return shell("import", "import", body);
}
