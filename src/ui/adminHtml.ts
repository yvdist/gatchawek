/**
 * Pure HTML builders for the admin panel. No fetch, no db: `(args) => string`.
 * All DB/user values pass through escapeHtml.
 */

import {
  RENDER_BATCH_MAX,
  type AdminCardDetail,
  type AdminCardKindFilter,
  type AdminCardRow,
  type AdminCounts,
  type AdminPoolOption,
  type AdminQueueStatus,
} from "../db/queries/admin.js";
import type { QueueRow } from "../db/queries/inject.js";
import {
  RARITY_COLOR,
  RARITY_KEYS,
  RARITY_LABEL,
  RARITY_STARS,
  type RarityKey,
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

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap";

const ADMIN_CSS = `:root{color-scheme:dark;--bg:#15171c;--surface:#1d2027;--surface-2:#262a33;--border:#343944;--text:#eef1f6;--muted:#a2a9b8;--accent:#6ea0ff;--accent-solid:#2b63d9;--accent-ink:#0f1115;--paper:#ebe8e1;--paper-ink:#24262c;--success:#4ade80;--warning:#fbbf24;--error:#f87171;--radius:.9rem}*,*::before,*::after{box-sizing:border-box}html{background:var(--bg)}body{min-height:100vh;background:var(--bg);color:var(--text);font-family:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--pico-font-family:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--pico-background-color:transparent;--pico-color:var(--text);--pico-primary:var(--accent);--pico-muted-border-color:var(--border);--pico-form-element-background-color:var(--surface-2);--pico-form-element-border-color:var(--border);--pico-form-element-color:var(--text);--pico-card-background-color:var(--surface)}h1,h2,h3{letter-spacing:-.025em;font-weight:750;color:var(--text)}.grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:1.1rem;margin-bottom:1rem}article.tile{min-width:0;position:relative;display:flex;flex-direction:column;gap:.5rem;margin:0;padding:0;background:none;box-shadow:none;border-radius:0}.tile-art{position:relative;display:block;aspect-ratio:2/3;border-radius:14px;overflow:hidden;text-decoration:none;transition:transform .18s ease,box-shadow .18s ease}.tile-art:hover{transform:translateY(-3px)}.is-rendered .tile-art{background:var(--surface-2);border:1px solid color-mix(in srgb,var(--rc) 40%,var(--border));box-shadow:0 6px 14px -8px rgba(0,0,0,.7)}.is-rendered .tile-art:hover{border-color:var(--rc);box-shadow:0 12px 22px -10px rgba(0,0,0,.8)}.tile-art>img{width:100%;height:100%;object-fit:cover;display:block}.is-raw .tile-art{background:var(--paper);color:var(--paper-ink);border:2px dashed #b7b2a6;display:flex;flex-direction:column;padding:.6rem;gap:.55rem}.is-raw .tile-art:hover,.is-final .tile-art:hover{transform:none}.sheet-photo{flex:1;border-radius:8px;overflow:hidden;background:#d8d4cb;display:grid;place-items:center;color:#4f4b44;font-size:.8rem;text-align:center;padding:0}.sheet-photo img{width:100%;height:100%;object-fit:cover;display:block}.sheet-name{font-weight:750;font-size:1rem;line-height:1.15;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sheet-sub{display:flex;justify-content:space-between;gap:.4rem;font-size:.75rem;color:#5a564e}.sheet-stars{color:var(--rc);filter:brightness(.75)}.sheet-tag{position:absolute;bottom:.5rem;left:.5rem;right:.5rem;justify-content:center;text-align:center;font-size:.75rem;font-weight:650;padding:.12rem .45rem;border-radius:999px;background:var(--paper-ink);color:var(--paper)}.tile.is-off .tile-art{filter:grayscale(.85);opacity:.55}.tile-meta{display:flex;flex-direction:column;gap:.15rem;padding:0 .15rem}.meta-1{color:var(--text);font-weight:600;font-size:.86rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tile-meta .badge{align-self:flex-start;margin-top:.2rem}.tile-meta small{color:var(--muted);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tile-badges{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.2rem}label.tile-pick{position:absolute;top:.35rem;left:.35rem;z-index:2;display:grid;place-items:center;width:44px;height:44px;min-width:44px;border-radius:10px;background:rgba(21,23,28,.82);margin:0;cursor:pointer}.tile-pick input{margin:0;width:22px;height:22px;border:2px solid #fff;background-color:rgba(255,255,255,.08)}.tile-pick.is-off{cursor:not-allowed}.tile-pick.is-off input{opacity:.45}.is-final .tile-art{background:var(--surface-2);border:1px solid var(--border);box-shadow:0 6px 14px -8px rgba(0,0,0,.7)}.is-pending .tile-art{border-color:var(--accent);border-style:solid;border-width:3px}.searchbox{position:relative;flex:1;display:flex;min-width:0}.searchbox input[type=search]{padding-right:3rem}.search-x{position:absolute;right:.2rem;top:50%;transform:translateY(-50%);width:44px;height:44px;display:grid;place-items:center;border-radius:8px;color:var(--muted);text-decoration:none;font-size:1.1rem;line-height:1}.search-x:hover{color:var(--text);background:var(--surface)}.pathrow{display:flex;gap:.5rem;align-items:center;margin-top:.6rem;min-width:0}.pathrow{max-width:100%}.pathrow a{flex:1;min-width:0}.pathrow code{flex:1;min-width:0;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem;color:var(--muted);background:none;padding:0}.btn-sm{padding:.3rem .6rem;font-size:.8rem}.titlerow{display:flex;gap:.7rem;align-items:center;flex-wrap:wrap}.titlerow h1{margin:0}.stack{display:grid;gap:1rem}.card form{margin-bottom:0}.empty-state{padding:3rem 1rem;text-align:center;color:var(--muted);border:1.5px dashed var(--border);border-radius:var(--radius)}.legend-box{position:relative;flex:none;margin:0}.legend-box summary{list-style:none;width:44px;height:44px;display:grid;place-items:center;border-radius:999px;border:1px solid var(--border);color:var(--muted);cursor:pointer;font-weight:700}.legend-box summary::-webkit-details-marker{display:none}.legend-box summary::after{display:none}.legend-box[open] summary{color:var(--text);border-color:var(--accent)}.legend-pop{position:absolute;right:0;top:calc(100% + .4rem);z-index:6;width:min(20rem,86vw);display:grid;gap:.55rem;padding:.8rem .9rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 12px 28px -12px rgba(0,0,0,.8);font-size:.84rem;color:var(--muted)}.legend-pop span{display:flex;align-items:center;gap:.55rem}.legend-pop i{flex:none;width:22px;height:30px;border-radius:4px}.lg-r{background:linear-gradient(160deg,#59606e,#2c313b);border:1px solid #8a92a3}.lg-f{background:#59606e;border:1px solid var(--border);box-shadow:inset 0 -6px 0 #24262c}.lg-p{background:var(--paper);border:1.5px dashed #b7b2a6}.sheet-tag{display:inline-flex;align-items:center;gap:.3rem}.sheet-tag.tone-raw,.sheet-tag.tone-final{background:#24262c;color:#eef1f6}.sheet-tag.tone-empty{background:#8f2f2f;color:#fff}.sheet-tag.tone-pending{background:var(--accent-solid);color:#fff}.sheet-tag.tone-stale{background:var(--warning);color:#1d1606}.badge.tone-raw{background:var(--surface-2);border-color:#5b616e}.badge.tone-final{background:var(--surface-2);border-color:#6b7280;color:var(--muted)}.badge.tone-empty{background:rgba(248,113,113,.14);border-color:rgba(248,113,113,.5)}.badge.tone-pending{background:rgba(43,99,217,.2);border-color:rgba(110,160,255,.6)}.badge.tone-stale{background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.6)}.badge.tone-done{background:rgba(74,222,128,.12);border-color:rgba(74,222,128,.45)}.rdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--rc);margin-right:.35rem;vertical-align:.05em}.filter-select{display:none}.pager{display:flex;gap:1rem;font-size:.9rem}.pager a{color:var(--muted);text-decoration:none}.pager a:hover{color:var(--text)}.detail-top{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}.detail-top .backlink{margin-bottom:0}.render-one{margin-top:.6rem}#renderForm .grid-cards{margin-bottom:1.4rem}.is-stale .tile-art{border-color:var(--warning);border-style:solid;border-width:3px}.lg-pend{border:3px solid var(--accent)!important}.lg-stale{border:3px solid var(--warning)!important}.lg-empty{background:#d8d4cb!important}.legend-note{font-size:.78rem;border-top:1px solid var(--border);padding-top:.5rem}.tab-n{display:inline-block;min-width:1.4em;padding:0 .35em;margin-left:.2rem;border-radius:999px;background:rgba(255,255,255,.08);font-size:.76rem;font-variant-numeric:tabular-nums;text-align:center}.tabs a.is-active .tab-n{background:rgba(255,255,255,.22)}.meta-1{display:flex;justify-content:space-between;gap:.4rem;align-items:baseline}.tile-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tile-stars{flex:none;color:var(--muted);font-size:.78rem;letter-spacing:.02em}details.replace{padding:0}details.replace>summary{padding:1rem 1.1rem;cursor:pointer;font-weight:700;font-size:1.05rem}details.replace[open]>summary{border-bottom:1px solid var(--border);margin-bottom:.8rem}details.replace>*:not(summary){margin-left:1.1rem;margin-right:1.1rem}details.replace>form:last-child{margin-bottom:1rem}.pick-all{display:inline-flex;align-items:center;gap:.5rem;font-size:.88rem;color:var(--muted);margin:0}.pick-all input{margin:0}.tile-actions{display:flex;gap:.4rem;margin-top:.45rem}.tile-actions form{margin:0;flex:1}.tile-actions button{width:100%;padding:.45rem .5rem;font-size:.88rem}.tile-err{margin:.3rem 0 0;font-size:.78rem;color:var(--error);line-height:1.3}.login{width:min(24rem,92vw)}.login-card{padding:1.6rem;position:relative;z-index:1;margin:0}.login-card h1{font-size:30px;margin:0 0 .35rem}.login-card .lede{margin:0 0 1.2rem}.login-card .btn{width:100%;margin-top:.3rem}.fan{position:relative;height:120px;margin-bottom:-28px}.fan i{position:absolute;left:50%;bottom:0;width:78px;height:112px;border-radius:12px;background:linear-gradient(150deg,var(--rc),color-mix(in srgb,var(--rc) 35%,var(--bg)));box-shadow:0 12px 30px -10px var(--rc);border:2px solid color-mix(in srgb,var(--rc) 60%,#fff)}.fan i:nth-child(1){transform:translateX(-120%) rotate(-14deg)}.fan i:nth-child(2){transform:translateX(-50%) translateY(-10px);z-index:1}.fan i:nth-child(3){transform:translateX(20%) rotate(14deg)}.card h2{font-size:1.2rem;margin-bottom:.6rem}.guide{margin-bottom:1.2rem}.guide ol{font-size:.94rem;color:var(--muted)}.guide strong{color:var(--text)}.fname{font-size:clamp(1.05rem,2.4vw,1.45rem);font-weight:700;letter-spacing:-.01em;margin:0 0 .9rem;padding:.8rem 1rem;border-radius:.7rem;background:var(--surface-2);overflow-wrap:anywhere}.seg-r{color:var(--r-secret)}.seg-g{color:var(--r-super_rare)}.seg-n{color:var(--r-ultra_rare)}.chips code{background:var(--surface-2);color:var(--muted);border-radius:999px;padding:.2rem .6rem}.dropzone{position:relative}.dropzone p{margin:.35rem 0}a{color:var(--accent)}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.topbar{display:block;position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--border)}.topbar-inner{width:100%;max-width:1120px;margin:0 auto;padding:.7rem 20px;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.brand{display:inline-flex;align-items:center;gap:.45rem;font-weight:700;color:var(--text);margin-right:.5rem}.brand svg{width:16px;height:16px}.navlink{display:inline-block;padding:.4rem .85rem;border-radius:999px;color:var(--muted);text-decoration:none;font-size:.92rem;font-weight:550}.navlink:hover{color:var(--text);background:rgba(110,160,255,.08)}.navlink.is-active{background:rgba(110,160,255,.16);color:#fff}.topbar .sp{flex:1}.wrap{max-width:1120px;margin:0 auto;padding:24px 20px 64px}.pagehead{margin:0 0 1.1rem}.pagehead h1{font-size:clamp(28px,4vw,42px);line-height:1.05;margin:.25rem 0 .5rem}.lede{color:var(--muted);max-width:65ch;margin:.25rem 0 0;text-wrap:pretty}.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.1rem}.card h2,.card h3{margin-top:0}.tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}table{width:100%;border-collapse:collapse;margin-bottom:0}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);position:sticky;top:0;background:var(--surface);text-align:left;padding:.6rem .7rem;border-bottom:1px solid var(--border)}td{padding:.55rem .7rem;border-bottom:1px solid var(--border);vertical-align:middle}tr:last-child td{border-bottom:none}table img{width:48px;height:48px;border-radius:.5rem;object-fit:cover}.badge{display:inline-flex;align-items:center;gap:.35rem;padding:.15rem .55rem;border-radius:999px;font-size:.78rem;border:1px solid var(--border);background:var(--surface-2);color:var(--text);white-space:nowrap}.badge i{width:8px;height:8px;border-radius:50%;background:var(--rc,var(--r-common));display:inline-block}.b-off{background:var(--surface-2);color:var(--muted)}.thumb-broken{border:2px solid var(--error)}.btn{display:inline-block;background:var(--accent-solid);color:#fff;font-family:inherit;width:auto;margin:0;border:1px solid transparent;border-radius:.6rem;padding:.55rem 1rem;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .12s ease,background .12s ease}.btn:hover{background:#2255c0;color:#fff;transform:translateY(-1px)}.btn:active{transform:translateY(0)}.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}.btn-ghost{display:inline-block;font-family:inherit;width:auto;margin:0;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:.6rem;padding:.55rem 1rem;text-decoration:none;cursor:pointer}.btn-ghost:hover{border-color:var(--accent);color:#fff}.btn-danger-outline{display:inline-block;background:transparent;color:var(--error);border:1px solid var(--error);border-radius:.6rem;padding:.55rem 1rem;cursor:pointer}.alert{padding:.6rem .8rem;border-radius:.6rem;border:1px solid var(--border);background:var(--surface-2)}.alert.is-ok{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.1)}.alert.is-err{border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.1)}.alert.is-info{border-color:rgba(110,160,255,.5);background:rgba(110,160,255,.1)}.field{display:grid;gap:.3rem;margin-bottom:.8rem}.field label{font-size:13px;color:var(--muted)}input[type=text],input[type=search],input[type=password],input[type=url],select{background:var(--surface-2);border:1px solid var(--border);border-radius:.6rem;padding:.55rem .7rem;color:var(--text);max-width:100%}input:focus,select:focus{border-color:var(--accent)}.import-table input,.import-table select{margin-bottom:0;min-width:130px}.tabs{display:inline-flex;justify-content:flex-start;gap:2px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:3px;flex-wrap:nowrap;max-width:100%;overflow-x:auto;scrollbar-width:none}.tabs a{flex:none;white-space:nowrap}.tabs a{padding:.35rem .85rem;border-radius:999px;color:var(--muted);text-decoration:none;font-size:.88rem}.tabs a.is-active{background:var(--accent-solid);color:#fff;font-weight:600}.search-clear{flex:none;align-self:center;font-size:.88rem}.toolbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:1.1rem}.filters{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}.filters select{max-width:12rem}.toolbar .legend-box{order:3}.toolbar form[role=search]{display:flex;gap:.5rem;flex:1 1 420px;min-width:0;margin-bottom:0;order:2}.toolbar form[role=search] input[type=search]{margin:0;flex:1;min-width:140px;height:auto;width:100%}.toolbar form[role=search] .btn-ghost{flex:none}.statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.9rem;margin-bottom:1rem}.stat{display:flex;flex-direction:column;gap:.15rem}.stat-label{font-size:13px;color:var(--muted)}.stat-num{font-size:44px;font-weight:800;line-height:1;letter-spacing:-.04em}.stat-link{font-size:.88rem;font-weight:600}.stat-done{font-size:.88rem;color:var(--muted)}.stat.is-zero .stat-num{color:var(--muted)}.stat.tone-stale{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.5)}.stat.tone-empty{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.45)}.stat.tone-pending{background:rgba(43,99,217,.1);border-color:rgba(110,160,255,.5)}.stat.tone-raw{border-color:#5b616e}.pick-group{display:inline-flex;align-items:center;gap:.8rem;flex-wrap:wrap}.refresh-note{margin:.35rem 0 0;text-wrap:pretty;max-width:65ch}.backlink{display:inline-block;margin-bottom:1rem;color:var(--muted);text-decoration:none}.backlink:hover{color:var(--text)}label.btn{cursor:pointer}.detail{display:grid;grid-template-columns:280px 1fr;gap:1.5rem;margin-bottom:1rem;align-items:start}.detail .tile-art:hover{transform:none}.detail>.tile{min-width:0;width:100%;max-width:280px}.detail-note{margin:.6rem 0 0;font-size:.84rem;color:var(--muted)}.detail-path{display:block;margin-top:.5rem;font-size:.75rem;color:var(--muted);overflow-wrap:anywhere}.or{margin:.2rem 0 .8rem;color:var(--muted);font-size:.85rem}.kv{display:grid;grid-template-columns:auto 1fr;gap:.35rem .9rem;margin:0}.kv dt{font-size:13px;color:var(--muted)}.detail>*{min-width:0}.stack{min-width:0}.kv dd{min-width:0;overflow-wrap:anywhere}.titlerow h1{overflow-wrap:anywhere;min-width:0}.card.meta{overflow:hidden}.preview{position:sticky;top:76px;display:grid;gap:.6rem;min-width:0}.preview-meta{display:flex;gap:.5rem;flex-wrap:wrap;font-size:.8rem;color:var(--muted)}.preview-meta a{color:inherit}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.formgrid .check{display:flex;gap:.5rem;align-items:center;margin:0}.kv dd{margin:0}.guide ol{margin:.4rem 0 .6rem;padding-left:1.2rem;display:grid;gap:.4rem}.chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem}.chips code{font-size:.8rem}.dropzone{border:1.5px dashed #464c58;border-radius:var(--radius);padding:2rem 1rem;text-align:center;cursor:pointer;transition:background .15s ease,border-color .15s ease;margin-bottom:1rem;background:var(--surface-2)}.dropzone.is-dragover{border-color:var(--accent);background:rgba(110,160,255,.08)}.dropzone svg{width:28px;height:28px;color:var(--muted)}.file-hidden{position:absolute;top:0;left:0;width:1px!important;height:1px!important;padding:0!important;margin:0!important;border:0!important;opacity:0;overflow:hidden;pointer-events:none}.hint{font-size:.82rem;color:var(--muted)}.import-thumb{width:64px;height:64px;object-fit:cover;border-radius:.35rem}.status-ok{color:var(--success)}.status-err{color:var(--error)}.status-wait{color:var(--warning)}button.btn,button.btn-ghost,.actionbar button{width:auto;margin:0}.actionbar{position:sticky;bottom:0;z-index:5;justify-content:space-between;background:var(--surface);border-top:1px solid var(--border);padding:.7rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.loginwrap{min-height:100vh;display:grid;place-items:center;padding:1rem}@media (max-width:860px){.statgrid{grid-template-columns:repeat(2,1fr)}.detail{grid-template-columns:1fr}}@media (max-width:640px){.hint-long{display:none}.brand-text{display:none}.topbar-inner{flex-wrap:nowrap;gap:.2rem;padding:.55rem 12px;overflow-x:auto;scrollbar-width:none}.navlink{padding:.35rem .45rem;font-size:.84rem}.topbar .btn-ghost{padding:.35rem .55rem;font-size:.84rem}.navlink{flex:none}.topbar .sp{flex:1 0 .2rem}.detail>.tile{max-width:220px}.detail>.preview{max-width:320px;margin-inline:auto;width:100%}.toolbar form[role=search]{order:-1;flex-basis:100%}.toolbar .filters{order:3;flex-basis:100%}.toolbar .filters select{flex:1;max-width:none}.tabs{-webkit-mask-image:linear-gradient(90deg,#000 82%,transparent);mask-image:linear-gradient(90deg,#000 82%,transparent);padding-right:1.5rem;max-width:calc(100% - 60px)}.wrap{padding:18px 14px 56px}}@media (max-width:520px){.tabs{display:none}.filter-select{display:block;flex:1;margin:0;min-width:0}.statgrid{grid-template-columns:1fr}.grid-cards{grid-template-columns:repeat(2,1fr);gap:.8rem}}@media (prefers-reduced-motion:reduce){*{transition:none!important}}`;

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
// Rarity tokens come from RARITY_COLOR so the panel can never drift from the bot's embeds.
const RARITY_CSS = `:root{${RARITY_KEYS.map((k) => `--r-${k}:${hex(RARITY_COLOR[k])}`).join(";")}}${RARITY_KEYS.map((k) => `.r-${k}{--rc:var(--r-${k})}`).join("")}`;
const STYLE = `<style>${ADMIN_CSS}${RARITY_CSS}</style>`;

function shell(title: string, active: AdminPage, body: string): string {
  const link = (href: string, label: string, on: boolean): string =>
    `<a class="navlink${on ? " is-active" : ""}" href="${href}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · admin</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="${BASE}">${STYLE}</head><body><nav class="topbar"><div class="topbar-inner"><span class="brand"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10.7 2.3a2.6 2.6 0 0 0-3.4 3.4L2.6 10.4l3 3 4.7-4.7a2.6 2.6 0 0 0 3.4-3.4l-2 2-1.4-1.4 2-2.6z"/></svg><span class="brand-text">Admin</span></span>${link("/admin", "Dashboard", active === "dashboard")}${link("/admin/cards", "Kartu", active === "cards" || active === "card")}${link("/admin/inject", "Inject", active === "inject")}${link("/admin/import", "Import", active === "import")}<span class="sp"></span><form method="post" action="/admin/logout"><button type="submit" class="btn-ghost">Logout</button></form></div></nav><main class="wrap">${body}</main></body></html>`;
}

export function loginPage(error: string | null): string {
  const err = error === null ? "" : `<p class="alert is-err" role="alert">${escapeHtml(error)}</p>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>login · admin</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="${BASE}">${STYLE}</head><body><main class="loginwrap"><div class="login"><div class="fan" aria-hidden="true"><i class="r-rare"></i><i class="r-secret"></i><i class="r-holo"></i></div><div class="card login-card"><h1>Gatchawek admin</h1><p class="lede">Masukkan password owner untuk mengelola katalog kartu.</p>${err}<form method="post" action="/admin/login"><div class="field"><label for="loginPw">Password</label><input id="loginPw" type="password" name="password" required autocomplete="current-password" autofocus></div><button class="btn" type="submit">Masuk</button></form></div></div></main></body></html>`;
}

export function dashboardPage(counts: AdminCounts): string {
  // Each card is a to-do; a zero is "done" and gets neither a tone nor a link.
  const work = (label: string, value: number, href: string, tone: string, action: string): string =>
    `<article class="card stat${value === 0 ? " is-zero" : ` ${tone}`}"><span class="stat-label">${label}</span><span class="stat-num">${value}</span>${value === 0 ? `<span class="stat-done">Beres</span>` : `<a class="stat-link" href="${href}">${action}</a>`}</article>`;
  return shell(
    "dashboard",
    "dashboard",
    `<div class="pagehead"><h1>Dashboard</h1><p class="lede">${counts.total} kartu di katalog. Ini yang perlu ditindaklanjuti.</p></div><div class="statgrid">${work("Render gagal?", counts.renderStale, "/admin/cards?kind=todo", "tone-stale", "Pilih ulang")}${work("Tanpa image", counts.empty, "/admin/cards?kind=empty", "tone-empty", "Lihat")}${work("Belum dirender", counts.remote, "/admin/cards?kind=remote", "tone-raw", "Lihat")}${work("Inject pending", counts.pending, "/admin/inject?status=pending", "tone-pending", "Review")}</div><p><a class="btn" href="/admin/import">Import kartu baru</a></p>`,
  );
}

type CardState = "empty" | "pending" | "stale" | "raw" | "final" | "rendered";

const STATE_LABEL: Record<CardState, string> = {
  empty: "tanpa image",
  pending: "sedang dirender",
  stale: "render gagal?",
  raw: "belum dirender",
  final: "foto asli",
  rendered: "sudah dirender",
};
const STATE_TONE: Record<CardState, string> = {
  empty: "tone-empty",
  pending: "tone-pending",
  stale: "tone-stale",
  raw: "tone-raw",
  final: "tone-final",
  rendered: "tone-done",
};
const STATE_TILE: Record<CardState, string> = {
  empty: "is-raw",
  pending: "is-raw is-pending",
  stale: "is-raw is-stale",
  raw: "is-raw",
  final: "is-final",
  rendered: "is-rendered",
};

/** Remote photos in render-excluded pools are final as they are, enabled or not. */
function cardState(r: AdminCardRow): CardState {
  if (r.imageKind === "static") return "rendered";
  if (r.imageKind === "empty") return "empty";
  if (r.excludedPool) return "final";
  if (r.renderable && r.renderPending) return "pending";
  // A request whose window passed while the card is still raw most likely failed.
  if (r.renderable && r.renderRequestedAt !== null) return "stale";
  return "raw";
}
const CLOCK = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>`;
function pendingAgo(r: AdminCardRow, nowSec: number): string {
  if (r.renderRequestedAt === null) return STATE_LABEL.pending;
  const mins = Math.max(0, Math.floor((nowSec - r.renderRequestedAt) / 60));
  return mins === 0 ? "diminta barusan" : `diminta ${mins} mnt lalu`;
}
function stateText(r: AdminCardRow, nowSec: number): string {
  const st = cardState(r);
  if (st === "pending") return pendingAgo(r, nowSec);
  if (st === "stale") return `${STATE_LABEL.stale} ${pendingAgo(r, nowSec)}`;
  return STATE_LABEL[st];
}
function stateBadge(r: AdminCardRow): string {
  const st = cardState(r);
  return `<span class="badge ${STATE_TONE[st]}">${STATE_LABEL[st]}</span>`;
}
function rarityKey(key: string): RarityKey {
  return (RARITY_KEYS as readonly string[]).includes(key) ? (key as RarityKey) : "common";
}
// rendered/final show the image full-bleed; raw/pending/empty show a plain paper card.
function cardFace(r: AdminCardRow, base: string, nowSec: number, withTag = true): string {
  const name = escapeHtml(r.memberName);
  const src = escapeHtml(localImageSrc(base, r.imageFile));
  const broken = `onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'Gambar gagal dimuat. Ganti image di halaman kartu.'}))"`;
  const st = cardState(r);
  if (st === "rendered") return `<img src="${src}" alt="${name}" loading="lazy" ${broken}>`;
  const tag = !withTag
    ? ""
    : st === "pending"
      ? `<span class="sheet-tag ${STATE_TONE[st]}">${CLOCK} ${stateText(r, nowSec)}</span>`
      : st === "stale"
        ? `<span class="sheet-tag ${STATE_TONE[st]}" title="${stateText(r, nowSec)}">${CLOCK} ${STATE_LABEL.stale}</span>`
        : `<span class="sheet-tag ${STATE_TONE[st]}">${STATE_LABEL[st]}</span>`;
  if (st === "final") return `${tag}<img src="${src}" alt="${name}" loading="lazy" ${broken}>`;
  const photo = st === "empty" ? "belum ada foto" : `<img src="${src}" alt="${name}" loading="lazy" ${broken}>`;
  return `${tag}<span class="sheet-photo">${photo}</span>`;
}
function rarityBadge(key: string): string {
  const k = rarityKey(key);
  return `<span class="badge r-${k}"><i></i>${escapeHtml(`${RARITY_STARS[k]} ${RARITY_LABEL[k]}`)}</span>`;
}

const KIND_TABS: [AdminCardKindFilter, string][] = [
  ["todo", "Perlu dikerjakan"],
  ["empty", "Tanpa image"],
  ["remote", "Belum dirender"],
  ["static", "Selesai"],
  ["all", "Semua"],
];

const RENDER_SCRIPT = `<script>(function(){var MAX=${RENDER_BATCH_MAX};var btn=document.getElementById("renderBtn");var all=document.getElementById("pickAll");if(!btn)return;function boxes(){return Array.prototype.slice.call(document.querySelectorAll('input[name="ids"]'));}function sync(){var bs=boxes();var n=bs.filter(function(b){return b.checked;}).length;bs.forEach(function(b){b.disabled=!b.checked&&n>=MAX;});btn.disabled=n===0;btn.textContent="Minta render ("+n+"/"+MAX+")";if(all)all.checked=n>0&&n===Math.min(MAX,bs.length);}if(all)all.addEventListener("change",function(){var c=0;boxes().forEach(function(b){b.checked=all.checked&&c<MAX;if(b.checked)c++;});sync();});document.addEventListener("change",function(e){if(e.target&&e.target.name==="ids")sync();});var ps=document.getElementById("pickStale");if(ps)ps.addEventListener("click",function(){var c=boxes().filter(function(b){return b.checked;}).length;boxes().forEach(function(b){if(b.hasAttribute("data-stale")&&!b.checked&&c<MAX){b.checked=true;c++;}});sync();});sync();})();</script>`;

export function cardsPage(args: {
  rows: AdminCardRow[];
  total: number;
  kind: AdminCardKindFilter;
  q: string;
  base: string;
  poolId: string;
  groupId: string;
  rarity: string;
  pools: AdminPoolOption[];
  poolGroups: AdminPoolGroupOption[];
  renderMessage?: string | null;
  renderOk?: boolean;
  nowSec?: number;
  counts?: Partial<Record<AdminCardKindFilter, number>>;
}): string {
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const bits: string[] = [`kind=${args.kind}`];
  if (args.q !== "") bits.push(`q=${encodeURIComponent(args.q)}`);
  if (args.poolId !== "") bits.push(`pool=${encodeURIComponent(args.poolId)}`);
  if (args.groupId !== "") bits.push(`group=${encodeURIComponent(args.groupId)}`);
  if (args.rarity !== "") bits.push(`rarity=${encodeURIComponent(args.rarity)}`);
  const qs = `?${bits.join("&")}`;
  const listUrl = `/admin/cards${qs}`;
  const tabQs = (k: AdminCardKindFilter): string => {
    const rest = bits.filter((b) => !b.startsWith("kind="));
    return `?kind=${k}${rest.length > 0 ? `&${rest.join("&")}` : ""}`;
  };
  const tabs = KIND_TABS.map(
    ([k, label]) => {
      const n = args.counts?.[k];
      return `<a class="${k === args.kind ? "is-active" : ""}" href="/admin/cards${escapeHtml(tabQs(k))}"${k === args.kind ? ' aria-current="page"' : ""}>${label}${n === undefined ? "" : ` <span class="tab-n">${n}</span>`}</a>`;
    },
  ).join("");
  const canPick = (r: AdminCardRow): boolean => {
    const st = cardState(r);
    return r.renderable && (st === "raw" || st === "stale");
  };
  const selectable = args.rows.filter(canPick).length;
  const staleCount = args.rows.filter((r) => canPick(r) && cardState(r) === "stale").length;
  const showBulk = selectable > 0;
  const select = `<select class="filter-select" aria-label="Filter status kartu" onchange="location.href=this.value">${KIND_TABS.map(([k, label]) => {
    const n = args.counts?.[k];
    return `<option value="/admin/cards${escapeHtml(tabQs(k))}"${k === args.kind ? " selected" : ""}>${label}${n === undefined ? "" : ` (${n})`}</option>`;
  }).join("")}</select>`;
  // While a render is in flight, reload every minute so finished cards appear, unless the owner is mid-selection.
  const refresh = args.rows.some((r) => cardState(r) === "pending")
    ? `<script>(function(){var at=document.getElementById("loadedAt");if(at)at.textContent=new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});function t(){if(document.querySelector('input[name="ids"]:checked')||document.querySelector(".legend-box[open]"))return setTimeout(t,60000);location.reload();}setTimeout(t,60000);})();</script>`
    : "";
  const refreshNote = refresh === ""
    ? ""
    : `<p class="hint refresh-note">Diperbarui otomatis tiap 1 menit selama ada render berjalan<span class="loaded"> · dimuat <span id="loadedAt"></span></span>. Dijeda saat kamu sedang memilih kartu.</p>`;
  const tiles = args.rows
    .map((r) => {
      const rk = rarityKey(r.rarity);
      const st = cardState(r);
      const name = escapeHtml(r.memberName);
      let pick = "";
      if (showBulk && canPick(r)) {
        pick = `<label class="tile-pick"><input type="checkbox" name="ids" value="${escapeHtml(r.id)}"${st === "stale" ? " data-stale" : ""} aria-label="Pilih ${name} untuk dirender"></label>`;
      }
      return `<article class="tile ${STATE_TILE[st]} r-${rk}${r.enabled ? "" : " is-off"}">${pick}<a class="tile-art" href="/admin/cards/${escapeHtml(r.id)}?from=${encodeURIComponent(listUrl)}" aria-label="${name}, ${RARITY_LABEL[rk]}, ${stateText(r, nowSec)}${r.enabled ? "" : ", nonaktif dan tersembunyi dari pemain"}">${cardFace(r, args.base, nowSec)}</a><div class="tile-meta"><span class="meta-1"><span class="tile-name">${name}</span><span class="tile-stars" aria-hidden="true"><i class="rdot"></i>${RARITY_STARS[rk]}</span></span><small>${escapeHtml(r.poolName)} · ${escapeHtml(r.groupBadge)} #${r.photoNo}</small>${r.enabled ? "" : `<span class="badge b-off">nonaktif</span>`}</div></article>`;
    })
    .join("");
  const banner =
    args.renderMessage !== undefined &&
    args.renderMessage !== null &&
    args.renderMessage !== ""
      ? `<p class="alert ${args.renderOk === true ? "is-ok" : args.renderOk === false ? "is-err" : "is-info"}" role="alert">${escapeHtml(args.renderMessage)}</p>`
      : "";
  const count =
    args.rows.length < args.total
      ? `Menampilkan ${args.rows.length} dari ${args.total} kartu. Persempit dengan pencarian.`
      : `${args.total} kartu.`;
  const bulkOpen = showBulk
    ? `<form id="renderForm" method="post" action="/admin/cards/render-remote"><input type="hidden" name="back" value="${escapeHtml(listUrl)}">`
    : "";
  const bulkClose = showBulk
    ? `<div class="actionbar"><span class="pick-group"><label class="pick-all"><input type="checkbox" id="pickAll"> Pilih semua (${Math.min(RENDER_BATCH_MAX, selectable)})</label>${staleCount > 0 ? `<button type="button" class="btn-ghost btn-sm" id="pickStale">Pilih yang gagal (${staleCount})</button>` : ""}</span><button type="submit" id="renderBtn" class="btn" disabled title="Kartu dirender jadi bingkai di cloud dalam 15–30 menit. Cron juga merender otomatis tiap 15 menit.">Minta render (0/${RENDER_BATCH_MAX})</button></div></form>${RENDER_SCRIPT}`
    : "";
  const hasFilter = args.q !== "" || args.poolId !== "" || args.groupId !== "" || args.rarity !== "";
  const clear = !hasFilter ? "" : `<a class="search-x" href="/admin/cards${escapeHtml(tabQs(args.kind))}" aria-label="Hapus pencarian" title="Hapus pencarian">×</a>`;
  const empty =
    args.kind === "todo"
      ? `Semua kartu sudah selesai. <a href="/admin/import">Import kartu baru</a> atau lihat tab <a href="/admin/cards?kind=static">Selesai</a>.`
      : "Tidak ada kartu untuk filter ini.";
  const poolOptions = [`<option value="">Semua pool</option>`].concat(
    args.pools.map(
      (p) =>
        `<option value="${escapeHtml(p.poolId)}"${p.poolId === args.poolId ? " selected" : ""}>${escapeHtml(`${p.poolEmoji} ${p.poolName}`)}</option>`,
    ),
  ).join("");
  const visibleGroups =
    args.poolId === ""
      ? args.poolGroups
      : args.poolGroups.filter((g) => g.poolId === args.poolId);
  const groupOptions = [`<option value="">Semua grup</option>`].concat(
    visibleGroups.map(
      (g) =>
        `<option value="${escapeHtml(g.groupId)}"${g.groupId === args.groupId ? " selected" : ""}>${escapeHtml(args.poolId === "" ? `${g.poolName} · ${g.groupName}` : g.groupName)}</option>`,
    ),
  ).join("");
  const rarityOptions = [`<option value="">Semua rarity</option>`].concat(
    RARITY_KEYS.map(
      (r) =>
        `<option value="${r}"${r === args.rarity ? " selected" : ""}>${escapeHtml(RARITY_LABEL[r])}</option>`,
    ),
  ).join("");
  const filters = `<form method="get" action="/admin/cards" class="filters" aria-label="Filter pool, grup, dan rarity"><input type="hidden" name="kind" value="${escapeHtml(args.kind)}"><input type="hidden" name="q" value="${escapeHtml(args.q)}"><select name="pool" aria-label="Filter pool" onchange="this.form.submit()">${poolOptions}</select><select name="group" aria-label="Filter grup" onchange="this.form.submit()">${groupOptions}</select><select name="rarity" aria-label="Filter rarity" onchange="this.form.submit()">${rarityOptions}</select></form>`;
  const legend = `<details class="legend-box"><summary aria-label="Arti tampilan kartu" title="Arti tampilan kartu">?</summary><div class="legend-pop"><span><i class="lg-r"></i>Sudah dirender: bingkai kartu final</span><span><i class="lg-f"></i>Foto asli: pool ini memang tidak dirender</span><span><i class="lg-p"></i>Belum dirender: foto mentah, bisa dipilih untuk render</span><span><i class="lg-p lg-pend"></i>Sedang dirender: diminta kurang dari 30 menit lalu</span><span><i class="lg-p lg-stale"></i>Render gagal?: diminta lebih dari 30 menit lalu, belum jadi</span><span><i class="lg-p lg-empty"></i>Tanpa image: belum ada foto sama sekali</span><span class="legend-note">Render butuh 15–30 menit. Cron juga merender otomatis tiap 15 menit.</span></div></details>`;
  return shell(
    "kartu",
    "cards",
    `<div class="pagehead"><h1>Kartu</h1><p class="lede">${count}</p>${refreshNote}</div>${banner}<div class="toolbar"><nav class="tabs" aria-label="Filter status kartu">${tabs}</nav>${select}<form method="get" action="/admin/cards" role="search"><input type="hidden" name="kind" value="${escapeHtml(args.kind)}"><input type="hidden" name="pool" value="${escapeHtml(args.poolId)}"><input type="hidden" name="group" value="${escapeHtml(args.groupId)}"><input type="hidden" name="rarity" value="${escapeHtml(args.rarity)}"><span class="searchbox"><input type="search" name="q" value="${escapeHtml(args.q)}" placeholder="Cari kartu" aria-label="Cari kartu">${clear}</span><button class="btn-ghost" type="submit">Cari</button></form>${legend}${filters}</div>${bulkOpen}${tiles === "" ? `<p class="empty-state">${empty}</p>` : `<div class="grid-cards">${tiles}</div>`}${bulkClose}<script>(function(){var t=document.querySelector(".tabs .is-active");if(t&&t.scrollIntoView)t.scrollIntoView({block:"nearest",inline:"center"});var d=document.querySelector(".legend-box");if(!d)return;function close(){if(d.open){d.open=false;var s=d.querySelector("summary");if(s)s.focus();}}document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});document.addEventListener("click",function(e){if(d.open&&!d.contains(e.target))d.open=false;});})();</script>${refresh}`,
  );
}

export function cardDetailPage(args: {
  card: AdminCardDetail;
  base: string;
  message: string | null;
  ok: boolean;
  back?: string;
  prev?: { id: string; name: string } | undefined;
  next?: { id: string; name: string } | undefined;
  pools: AdminPoolOption[];
  poolGroups: AdminPoolGroupOption[];
}): string {
  const c = args.card;
  const rk = rarityKey(c.rarity);
  const st = cardState(c);
  const back = escapeHtml(args.back ?? "/admin/cards");
  const id = escapeHtml(c.id);
  const fromQs = args.back === undefined ? "" : `?from=${encodeURIComponent(args.back)}`;
  const fromField = args.back === undefined ? "" : `<input type="hidden" name="from" value="${back}">`;
  const step = (n: { id: string; name: string } | undefined, dir: "prev" | "next"): string =>
    n === undefined
      ? "<span></span>"
      : `<a class="pager-${dir}" href="/admin/cards/${escapeHtml(n.id)}${fromQs}">${dir === "prev" ? `← ${escapeHtml(n.name)}` : `${escapeHtml(n.name)} →`}</a>`;
  const pager =
    args.prev === undefined && args.next === undefined
      ? ""
      : `<nav class="pager" aria-label="Kartu lain di daftar ini">${step(args.prev, "prev")}${step(args.next, "next")}</nav>`;
  const note: Record<CardState, string> = {
    empty: "Kartu ini belum punya image. Upload file atau pakai URL di bawah.",
    pending: "Render sedang berjalan. Hasilnya muncul dalam 15–30 menit setelah diminta.",
    stale: "Render diminta lebih dari 30 menit lalu tapi belum jadi. Coba minta render lagi.",
    raw: "Foto ini belum dirender jadi kartu.",
    final: "Pool ini tidak dirender. Foto asli ini sudah bentuk akhirnya.",
    rendered: "",
  };
  const renderOne =
    (st === "raw" || st === "stale") && c.renderable
      ? `<form method="post" action="/admin/cards/render-remote"><input type="hidden" name="ids" value="${id}"><input type="hidden" name="back" value="/admin/cards/${id}${fromQs}"><button class="btn" type="submit">Minta render kartu ini</button></form>`
      : "";
  const msg =
    args.message === null
      ? ""
      : `<p class="alert ${args.ok ? "is-ok" : "is-err"}" role="alert">${escapeHtml(args.message)}</p>`;
  const nowSec = Math.floor(Date.now() / 1000);
  // Render is the primary action when available; upload steps back to secondary.
  const uploadCls = renderOne === "" ? "btn" : "btn-ghost";
  // Finished cards (rendered or final photo) keep replacement one deliberate step away.
  const finished = st === "rendered" || st === "final";
  const guard = finished
    ? ` onsubmit="return confirm('Ganti image kartu ini? Image yang sekarang akan ditimpa.')"`
    : "";
  const imgBtn = finished ? "btn-ghost" : uploadCls;
  const managePoolOptions = args.pools.map(
    (q) =>
      `<option value="${escapeHtml(q.poolId)}"${q.poolId === c.poolId ? " selected" : ""}>${escapeHtml(`${q.poolEmoji} ${q.poolName}`)}</option>`,
  ).join("");
  const manageGroups = args.poolGroups.filter((g) => g.poolId === c.poolId);
  const manageGroupOptions = manageGroups.map(
    (g) =>
      `<option value="${escapeHtml(g.groupId)}"${g.groupId === args.card.groupId ? " selected" : ""}>${escapeHtml(g.groupName)}</option>`,
  ).join("");
  const manageRarityOptions = RARITY_KEYS.map(
    (r) =>
      `<option value="${r}"${r === c.rarity ? " selected" : ""}>${escapeHtml(RARITY_LABEL[r])}</option>`,
  ).join("");
  const manage = `<section class="card kelola"><h2>Kelola kartu</h2><form method="post" action="/admin/cards/${id}/update">${fromField}<div class="formgrid"><div class="field"><label for="mName">Nama member</label><input id="mName" type="text" name="memberName" value="${escapeHtml(c.memberName)}" maxlength="60" required><p class="hint">Mengganti N foto milik member ini (${c.photoTotal}).</p></div><div class="field"><label for="mLabel">Label foto</label><input id="mLabel" type="text" name="photoLabel" value="${c.photoLabel === null ? "" : escapeHtml(c.photoLabel)}" maxlength="60"><p class="hint">Kosongkan untuk memakai nama member sebagai judul.</p></div><div class="field"><label for="mPool">Pool</label><select id="mPool" name="poolId">${managePoolOptions}</select></div><div class="field"><label for="mGroup">Grup</label><select id="mGroup" name="groupId">${manageGroupOptions}</select><p class="hint">Daftar grup mengikuti pool yang tampil saat ini; ganti pool lalu simpan ulang bila grup tujuan belum ada.</p></div><div class="field"><label for="mRarity">Rarity</label><select id="mRarity" name="rarity">${manageRarityOptions}</select></div><label class="check"><input type="checkbox" name="holoEnabled" value="1"${c.holoEnabled ? " checked" : ""}> Holo aktif</label></div><p class="hint">Peluang holo untuk super/ultra rare.</p><button class="btn" type="submit">Simpan perubahan</button></form></section>`;
  const previewMeta = `<div class="preview-meta"><span>${id}</span><span>${stateBadge(c)}</span><span>×${c.quantityOwned}</span><span>${escapeHtml(c.poolName)} · ${escapeHtml(c.groupBadge)} #${c.photoNo}</span></div>`;
  const preview = `<div class="preview"><div class="tile ${STATE_TILE[st]} r-${rk}${c.enabled ? "" : " is-off"}"><div class="tile-art">${cardFace(c, args.base, nowSec, false)}</div></div>${previewMeta}${note[st] === "" ? "" : `<p class="detail-note">${st === "pending" || st === "stale" ? `${pendingAgo(c, nowSec)}. ` : ""}${note[st]}</p>`}${renderOne === "" ? "" : `<div class="render-one">${renderOne}</div>`}${c.imageFile === "" ? "" : `<div class="pathrow"><a href="${escapeHtml(c.imageFile)}" title="${escapeHtml(c.imageFile)}"><code>${escapeHtml(c.imageFile)}</code></a><button type="button" class="btn-ghost btn-sm" data-copy="${escapeHtml(c.imageFile)}" onclick="var b=this;navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy).then(function(){b.textContent='Tersalin';});">Salin</button></div>`}</div>`;
  return shell(
    c.id,
    "card",
    `<div class="detail-top"><a class="backlink" href="${back}">← Kembali ke daftar</a>${pager}</div><div class="pagehead"><div class="titlerow"><h1>${escapeHtml(c.memberName)}</h1>${stateBadge(c)}</div><p class="lede">${id}</p></div>${msg}<div class="detail">${preview}<div class="stack">${manage}<div class="card meta"><dl class="kv"><dt>Member</dt><dd>${escapeHtml(c.memberName)}${c.fullName === null ? "" : ` (${escapeHtml(c.fullName)})`}</dd><dt>Pool · grup</dt><dd>${escapeHtml(c.poolName)} · ${escapeHtml(c.groupBadge)}</dd><dt>Rarity</dt><dd>${rarityBadge(c.rarity)}</dd><dt>Foto</dt><dd>${c.photoNo}/${c.photoTotal}${c.photoLabel === null ? "" : ` · ${escapeHtml(c.photoLabel)}`}</dd><dt>Tampil di kartu</dt><dd>Judul: <strong>${escapeHtml(c.photoLabel ?? c.memberName)}</strong> · Sub: ${escapeHtml(c.photoLabel !== null ? c.memberName : (c.fullName ?? "—"))}</dd><dt>Serial</dt><dd>${c.serial}</dd><dt>Dimiliki</dt><dd>×${c.quantityOwned}</dd><dt>Holo</dt><dd>${c.holoEnabled ? "ya" : "tidak"}</dd><dt>Sumber</dt><dd>${c.sourcePageUrl === null ? "—" : `<a href="${escapeHtml(c.sourcePageUrl)}" title="${escapeHtml(c.sourcePageUrl)}">${escapeHtml(c.sourcePageUrl)}</a>`}</dd></dl>${c.photoLabel !== null ? `<div class="card-actions" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem"><form method="post" action="/admin/cards/${id}/swap-names" onsubmit="return confirm('Tukar nama member ↔ label foto?')">${fromField}<button class="btn-ghost btn-sm" type="submit">Tukar nama ↔ label</button></form><form method="post" action="/admin/cards/${id}/promote-label" onsubmit="return confirm('Jadikan label sebagai nama member dan kosongkan label?')">${fromField}<button class="btn-ghost btn-sm" type="submit">Label → nama member</button></form></div>` : ""}</div>${finished ? `<details class="card replace"><summary>Ganti image</summary><p class="hint">Image yang sekarang akan ditimpa.</p>` : `<section class="card"><h2>Image</h2>`}<form method="post" action="/admin/cards/${id}/image" enctype="multipart/form-data"${guard}>${fromField}<div class="field"><label for="imgFile">Upload file (maks 8 MB)</label><input id="imgFile" type="file" name="file" accept="image/*" required></div><button class="${imgBtn}" type="submit">Upload file</button></form><p class="or">atau</p><form method="post" action="/admin/cards/${id}/image"${guard}>${fromField}<div class="field"><label for="imgUrl">URL gambar (https)</label><input id="imgUrl" type="url" name="url" placeholder="https://…" required></div><button class="btn-ghost" type="submit">Pakai URL ini</button></form>${finished ? "</details>" : "</section>"}<section class="card"><h2>Status</h2><p class="hint" style="margin-top:0">Kartu ${c.enabled ? "aktif dan bisa ditarik pemain" : "nonaktif, tersembunyi dari pemain"}.</p><form method="post" action="/admin/cards/${id}/enabled">${fromField}<input type="hidden" name="enabled" value="${c.enabled ? "0" : "1"}"><button class="btn-ghost" type="submit">${c.enabled ? "Nonaktifkan kartu" : "Aktifkan kartu"}</button></form></section></div></div>`,
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
  const tiles = args.rows
    .map((r) => {
      const known = r.rarity !== null && (RARITY_KEYS as readonly string[]).includes(r.rarity);
      const rk: (typeof RARITY_KEYS)[number] = known && r.rarity !== null ? r.rarity : "common";
      const name = escapeHtml(r.nama ?? "tanpa nama");
      const photo =
        r.imageUrl === null || r.imageUrl === ""
          ? "tanpa image"
          : `<img src="${escapeHtml(r.imageUrl)}" alt="${name}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'gagal dimuat'}))">`;
      const action =
        r.status === "pending"
          ? `<div class="tile-actions"><form method="post" action="/admin/inject/${escapeHtml(r.messageId)}/approve" onsubmit="return confirm('Approve ${escapeHtml(r.nama ?? r.messageId)}?')"><button class="btn" type="submit">Approve</button></form><form method="post" action="/admin/inject/${escapeHtml(r.messageId)}/reject" onsubmit="return confirm('Reject ${escapeHtml(r.messageId)}?')"><button type="submit" class="btn-danger-outline">Reject</button></form></div>`
          : `<div class="tile-badges"><span class="badge ${r.status === "approved" ? "tone-done" : "tone-empty"}">${escapeHtml(r.status)}</span></div>`;
      const errors = r.errors === null || r.errors === "" ? "" : `<p class="tile-err">${escapeHtml(r.errors)}</p>`;
      return `<article class="tile is-raw r-${rk}"><a class="tile-art" href="${escapeHtml(r.messageUrl)}" title="Buka pesan di Discord"><span class="sheet-photo">${photo}</span><span class="sheet-name">${name}</span><span class="sheet-sub"><span>${escapeHtml(r.grup ?? "—")}</span><span class="sheet-stars">${known ? RARITY_STARS[rk] : "?"}</span></span></a><div class="tile-meta"><small>${escapeHtml(r.pool ?? "—")} · ${known ? RARITY_LABEL[rk] : "rarity kosong"}</small>${errors}${action}</div></article>`;
    })
    .join("");
  return shell(
    "inject",
    "inject",
    `<div class="pagehead"><h1>Inject</h1><p class="lede">${args.total} kiriman ${escapeHtml(args.status)}. Approve atau reject di sini sama dengan tombol di Discord.</p></div><div class="toolbar"><nav class="tabs" aria-label="Filter status">${tabs}</nav></div>${ok}${tiles === "" ? `<p class="empty-state">${args.status === "pending" ? "Tidak ada kiriman yang menunggu review." : `Belum ada kiriman ${escapeHtml(args.status)}.`}</p>` : `<div class="grid-cards">${tiles}</div>`}`,
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
      inpNama.addEventListener("input",function(){item.nama=inpNama.value;refreshShow();});
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
      inpLabel.addEventListener("input",function(){item.label=inpLabel.value;refreshShow();});
      tdLabel.appendChild(inpLabel);
      var tdShow=document.createElement("td");
      var show=document.createElement("span");
      show.className="hint";
      tdShow.appendChild(show);
      function refreshShow(){var l=String(item.label||"").trim();var n=String(item.nama||"").trim();var judul=l!==""?l:n;var sub=l!==""?n:"\u2014";show.textContent="Judul: "+judul+" / Sub: "+sub;}
      refreshShow();

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
      tr.appendChild(tdShow);
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
  pools: AdminPoolOption[];
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
  const poolOptions = args.pools
    .map(
      (p) =>
        `<option value="${escapeHtml(p.poolId)}">${escapeHtml(`${p.poolEmoji} ${p.poolName}`)}</option>`,
    )
    .join("");
  const noPoolsWarn =
    args.pools.length === 0
      ? `<p class="alert is-err" role="alert">Belum ada pool aktif di database.</p>`
      : "";
  const body = `<div class="pagehead"><h1>Import kartu</h1><p class="lede">Pilih pool, seret gambar, periksa hasil baca nama file, lalu import ke katalog.</p></div>${errBanner}${resultsBlock}${noPoolsWarn}<section class="card guide"><h2>Format nama file</h2><p class="fname" aria-hidden="true"><span class="seg-r">(secret)</span> - <span class="seg-g">Jomok</span> - <span class="seg-n">Refi Kaget</span>.jpg</p><ol><li><strong>Pilih pool</strong> di dropdown di bawah — grup mengikuti segmen nama file dan dibuat otomatis bila belum ada.</li><li><strong>Beri nama file</strong> dengan pola <code>(rarity) - nama grup - nama kartu.ext</code></li><li><strong>Contoh:</strong> <code>(secret) - Jomok - Refi Kaget.jpg</code> → Rarity: <strong>★★★★★★ Secret</strong>, Grup: <strong>Jomok</strong>, Nama Kartu: <strong>Refi Kaget</strong> (Auto Title Case).</li><li><strong>Nama member</strong> = orang/karakter (mis. Salman Al-Fatih). <strong>Label foto</strong> = momen/judul foto (mis. Imam Besar Penakluk Konstantinopel). Judul besar di kartu = label bila ada, kalau tidak nama member. Subtitle kecil = nama member, hanya muncul bila label diisi.</li><li><strong>Import batch via nama file TIDAK mengisi label</strong> — isi kolom label agar dua baris.</li><li><strong>Tanpa grup:</strong> <code>(holo) - refi kaget.jpg</code> masuk grup pertama pool pilihan, dengan rarity <strong>★★★★★ Holo</strong>. Kode <code>(secret)</code> setara secret.</li></ol><div class="chips"><code>common (c/1)</code><code>rare (r/2)</code><code>super rare (sr/3)</code><code>ultra rare (ur/4)</code><code>holo (h/5)</code><code>secret (s/6)</code></div></section><form id="importForm" method="post" action="/admin/import" enctype="multipart/form-data"><div class="field"><label for="poolGroup">Target pool</label><select id="poolGroup" name="poolGroup" required>${poolOptions}</select></div><div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Seret dan lepas gambar ke sini atau klik untuk memilih file"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><p><strong>Seret gambar ke sini</strong></p><p><label class="btn" for="fileInput">Pilih file</label></p><p class="hint">JPG, PNG, atau WebP, maks 8 MB per file</p><input type="file" id="fileInput" class="file-hidden" name="files" accept="image/*" multiple></div><div id="previewWrap" hidden><div class="tablewrap"><table class="import-table"><thead><tr><th>preview</th><th>file</th><th>nama member (baris kecil saat berlabel)</th><th>rarity</th><th>label foto (judul besar, opsional, maks 60)</th><th>tampil</th><th>status</th><th></th></tr></thead><tbody id="previewBody"></tbody></table></div><div class="actionbar"><button type="submit" id="submitBtn"${args.pools.length === 0 ? " disabled" : ""} class="btn">Import ke Katalog</button><button type="button" id="clearBtn" class="btn-ghost">Bersihkan Daftar</button><span id="summaryText" class="hint"></span></div></div></form>${buildImportScript()}`;
  return shell("import", "import", body);
}
