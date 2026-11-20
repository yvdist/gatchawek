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

function shell(title: string, active: AdminPage, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · admin</title><link rel="stylesheet" href="${BASE}"><style>main{max-width:1100px;margin:0 auto;padding:1rem}nav{display:flex;gap:1rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap}nav .sp{flex:1}table img{width:96px;height:96px;object-fit:cover}.badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.8rem}.b-empty{background:#fee2e2}.b-remote{background:#fef3c7}.b-static{background:#dcfce7}.b-off{background:#e5e7eb}.thumb-broken{border:2px solid #ef4444}.kindpick{display:inline-block;margin:.1rem}.dropzone{border:2px dashed #3b82f6;border-radius:.75rem;padding:1.75rem 1rem;text-align:center;cursor:pointer;transition:background .15s ease,border-color .15s ease;margin-bottom:1rem}.dropzone.is-dragover{background:rgba(59,130,246,.08);border-color:#2563eb}.import-thumb{width:64px;height:64px;object-fit:cover;border-radius:.35rem}.tpl-box{padding:.75rem 1rem;border-radius:.5rem;border:1px solid #d1d5db;margin-bottom:1rem}.import-table input,.import-table select{margin-bottom:0;min-width:130px}.status-ok{color:#15803d}.status-err{color:#b91c1c}.status-wait{color:#b45309}</style></head><body><main><nav><strong>🛠️ admin</strong><a href="/admin"${active === "dashboard" ? ' aria-current="page"' : ""}>dashboard</a><a href="/admin/cards"${active === "cards" || active === "card" ? ' aria-current="page"' : ""}>kartu</a><a href="/admin/inject"${active === "inject" ? ' aria-current="page"' : ""}>inject</a><a href="/admin/import"${active === "import" ? ' aria-current="page"' : ""}>import</a><span class="sp"></span><form method="post" action="/admin/logout"><button type="submit" class="secondary outline">logout</button></form></nav>${body}</main></body></html>`;
}

export function loginPage(error: string | null): string {
  const err =
    error === null ? "" : `<p role="alert"><mark>${escapeHtml(error)}</mark></p>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>login · admin</title><link rel="stylesheet" href="${BASE}"></head><body><main class="container" style="max-width:28rem"><h1>🔐 admin login</h1>${err}<form method="post" action="/admin/login"><label>password<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">masuk</button></form></main></body></html>`;
}

export function dashboardPage(counts: AdminCounts): string {
  return shell(
    "dashboard",
    "dashboard",
    `<h1>dashboard</h1><div class="grid"><article><header>total kartu</header><h2>${counts.total}</h2></article><article><header>image kosong</header><h2>${counts.empty}</h2><a href="/admin/cards?kind=empty">lihat →</a></article><article><header>image remote/CDN</header><h2>${counts.remote}</h2><a href="/admin/cards?kind=remote">lihat →</a></article><article><header>inject pending</header><h2>${counts.pending}</h2><a href="/admin/inject?status=pending">review →</a></article></div><p><a role="button" href="/admin/import">📥 Import Kartu (Drag &amp; Drop) →</a></p>`,
  );
}

function kindBadge(kind: string): string {
  const cls =
    kind === "empty" ? "b-empty" : kind === "remote" ? "b-remote" : "b-static";
  return `<span class="badge ${cls}">${escapeHtml(kind)}</span>`;
}

const KINDS: AdminCardKindFilter[] = ["all", "empty", "remote", "static"];

export function cardsPage(args: {
  rows: AdminCardRow[];
  total: number;
  kind: AdminCardKindFilter;
  q: string;
  base: string;
}): string {
  const tabs = KINDS.map(
    (k) =>
      `<a role="button" class="kindpick${k === args.kind ? "" : " secondary outline"}" href="/admin/cards?kind=${k}${args.q === "" ? "" : `&amp;q=${encodeURIComponent(args.q)}`}">${k}</a>`,
  ).join("");
  const rows = args.rows
    .map((r) => {
      const thumb =
        r.imageKind === "empty"
          ? `<span class="badge b-empty">tanpa image</span>`
          : `<img src="${escapeHtml(localImageSrc(args.base, r.imageFile))}" alt="" loading="lazy" onerror="this.classList.add('thumb-broken');var b=this.nextElementSibling;if(b)b.hidden=false;"><span class="badge b-off" hidden>gagal dimuat</span>`;
      return `<tr><td>${thumb}</td><td><a href="/admin/cards/${escapeHtml(r.id)}">${escapeHtml(r.id)}</a></td><td>${escapeHtml(r.memberName)}</td><td>${escapeHtml(r.poolName)} · ${escapeHtml(r.groupBadge)}</td><td>${escapeHtml(r.rarity)}</td><td>${kindBadge(r.imageKind)}</td><td>×${r.quantityOwned}</td><td>${r.enabled ? "aktif" : `<span class="badge b-off">mati</span>`}</td></tr>`;
    })
    .join("");
  return shell(
    "kartu",
    "cards",
    `<h1>kartu (${args.total})</h1><div>${tabs}</div><form method="get" action="/admin/cards" role="search"><input type="hidden" name="kind" value="${escapeHtml(args.kind)}"><input type="search" name="q" value="${escapeHtml(args.q)}" placeholder="cari nama / id kartu"><button type="submit">cari</button></form><table><thead><tr><th>thumb</th><th>id</th><th>member</th><th>pool · grup</th><th>rarity</th><th>kind</th><th>owned</th><th>status</th></tr></thead><tbody>${rows === "" ? `<tr><td colspan="8">kosong.</td></tr>` : rows}</tbody></table>`,
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
      : `<img src="${escapeHtml(localImageSrc(args.base, c.imageFile))}" alt="" style="max-width:320px" onerror="this.classList.add('thumb-broken');var b=document.getElementById('imgwarn');if(b)b.hidden=false;"><p id="imgwarn" hidden><span class="badge b-off">⚠️ gagal dimuat — file static hilang atau URL mati</span></p>`;
  const rawBanner =
    c.imageKind === "remote"
      ? `<p><span class="badge b-remote">⚠️ image raw/CDN — rebuild pipeline (fetch-images → build-cards → seed → deploy) agar permanen</span></p>`
      : "";
  const msg =
    args.message === null
      ? ""
      : `<p role="alert"><mark>${escapeHtml(args.message)}</mark></p>`;
  return shell(
    c.id,
    "card",
    `<h1>${escapeHtml(c.id)}</h1>${msg}${img}${rawBanner}<ul><li>member: ${escapeHtml(c.memberName)}${c.fullName === null ? "" : ` (${escapeHtml(c.fullName)})`}</li><li>pool: ${escapeHtml(c.poolName)} · grup: ${escapeHtml(c.groupBadge)}</li><li>rarity: ${escapeHtml(c.rarity)} · foto ${c.photoNo}/${c.photoTotal}${c.photoLabel === null ? "" : ` · ${escapeHtml(c.photoLabel)}`}</li><li>serial: ${c.serial} · owned ×${c.quantityOwned} · holo: ${c.holoEnabled ? "ya" : "tidak"}</li><li>sumber: ${c.sourcePageUrl === null ? "—" : escapeHtml(c.sourcePageUrl)}</li><li>kind: ${kindBadge(c.imageKind)} · status: ${c.enabled ? "aktif" : "mati"}</li><li>image_file: <code>${escapeHtml(c.imageFile)}</code></li></ul><h2>ganti image</h2><form method="post" action="/admin/cards/${escapeHtml(c.id)}/image" enctype="multipart/form-data"><label>upload file (≤8 MB)<input type="file" name="file" accept="image/*" required></label><button type="submit">upload via discord</button></form><form method="post" action="/admin/cards/${escapeHtml(c.id)}/image"><label>atau set URL manual (https)<input type="url" name="url" placeholder="https://…" required></label><button type="submit">set URL</button></form><h2>status</h2><form method="post" action="/admin/cards/${escapeHtml(c.id)}/enabled"><input type="hidden" name="enabled" value="${c.enabled ? "0" : "1"}"><button type="submit">${c.enabled ? "nonaktifkan" : "aktifkan"}</button></form><p><a href="/admin/cards">← kembali</a></p>`,
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
    (s) =>
      `<a role="button" class="kindpick${s === args.status ? "" : " secondary outline"}" href="/admin/inject?status=${s}">${s}</a>`,
  ).join("");
  const ok = args.ok === null ? "" : `<p><mark>${escapeHtml(args.ok)}</mark></p>`;
  const rows = args.rows
    .map((r) => {
      const preview =
        r.imageUrl === null || r.imageUrl === ""
          ? `<span class="badge b-empty">tanpa image</span>`
          : `<a href="${escapeHtml(r.messageUrl)}"><img src="${escapeHtml(r.imageUrl)}" alt="" loading="lazy" onerror="this.classList.add('thumb-broken');var b=this.nextElementSibling;if(b)b.hidden=false;"><span class="badge b-off" hidden>gagal dimuat</span></a>`;
      const action =
        r.status === "pending"
          ? `<form method="post" action="/admin/inject/${escapeHtml(r.messageId)}/approve" onsubmit="return confirm('Approve ${escapeHtml(r.nama ?? r.messageId)}?')"><button type="submit">approve</button></form><form method="post" action="/admin/inject/${escapeHtml(r.messageId)}/reject" onsubmit="return confirm('Reject ${escapeHtml(r.messageId)}?')"><button type="submit" class="secondary outline">reject</button></form>`
          : escapeHtml(r.status);
      return `<tr><td>${preview}</td><td>${escapeHtml(r.nama ?? "—")}<br><small>${escapeHtml(r.messageId)}</small></td><td>${escapeHtml(r.pool ?? "—")} · ${escapeHtml(r.grup ?? "—")}</td><td>${escapeHtml(r.rarity ?? "—")}</td><td>${r.errors === null || r.errors === "" ? "—" : escapeHtml(r.errors)}</td><td><a href="${escapeHtml(r.messageUrl)}">pesan</a></td><td>${action}</td></tr>`;
    })
    .join("");
  return shell(
    "inject",
    "inject",
    `<h1>inject ${escapeHtml(args.status)} (${args.total})</h1><div>${tabs}</div>${ok}<table><thead><tr><th>preview</th><th>nama</th><th>pool · grup</th><th>rarity</th><th>errors</th><th>link</th><th>aksi</th></tr></thead><tbody>${rows === "" ? `<tr><td colspan="7">kosong.</td></tr>` : rows}</tbody></table><p>Approve/reject via web memakai logika yang sama dengan tombol Discord.</p>`,
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
      rm.className="secondary outline";
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
      ? `<p role="alert"><mark>${escapeHtml(args.error)}</mark></p>`
      : "";
  const resultsBlock =
    args.results !== undefined && args.results.length > 0
      ? `<article><header>Hasil Import (${String(args.results.length)})</header><ul>${args.results
          .map(
            (r) =>
              `<li>${r.ok ? "✅" : "❌"} <strong>${escapeHtml(r.filename)}</strong> — ${escapeHtml(r.message)}</li>`,
          )
          .join("")}</ul></article>`
      : "";
  const poolOptions = args.poolGroups
    .map(
      (pg) =>
        `<option value="${escapeHtml(`${pg.poolId}:${pg.groupId}`)}">${escapeHtml(`${pg.poolEmoji} ${pg.poolName} · ${pg.groupName} (${pg.groupBadge})`)}</option>`,
    )
    .join("");
  const noPoolsWarn =
    args.poolGroups.length === 0
      ? `<p role="alert"><mark>Belum ada pool/grup aktif di database.</mark></p>`
      : "";
  const body = `<h1>📥 Import Kartu (Drag &amp; Drop)</h1>${errBanner}${resultsBlock}${noPoolsWarn}<section class="tpl-box"><strong>Template Nama File:</strong> <code>(rarity) - nama grup - nama kartu.ext</code><br><small>Contoh: <code>(secret) - Jomok - Refi Kaget.jpg</code> → Rarity: <strong>★★★★★★ Secret</strong>, Grup: <strong>Jomok</strong>, Nama Kartu: <strong>Refi Kaget</strong> (Auto Title Case). Grup opsional: <code>(holo) - refi kaget.jpg</code> ikut target dropdown.</small><br><small>Kode Rarity: <code>(common)</code>/<code>(c)</code>/<code>(1)</code> · <code>(rare)</code>/<code>(r)</code>/<code>(2)</code> · <code>(super rare)</code>/<code>(sr)</code>/<code>(3)</code> · <code>(ultra rare)</code>/<code>(ur)</code>/<code>(4)</code> · <code>(holo)</code>/<code>(h)</code>/<code>(5)</code> · <code>(secret)</code>/<code>(s)</code>/<code>(6)</code></small></section><form id="importForm" method="post" action="/admin/import" enctype="multipart/form-data"><label>Target Pool · Grup<select id="poolGroup" name="poolGroup" required>${poolOptions}</select></label><div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Seret dan lepas gambar ke sini atau klik untuk memilih file"><p><strong>Drag &amp; drop gambar kartu ke sini</strong> atau pilih file di bawah</p><small>Format: JPG, PNG, WebP (maks 8 MB/file)</small><div style="margin-top:.75rem"><input type="file" id="fileInput" name="files" accept="image/*" multiple></div></div><div id="previewWrap" hidden><table class="import-table"><thead><tr><th>preview</th><th>file</th><th>nama kartu</th><th>rarity</th><th>label (opsional)</th><th>status</th><th></th></tr></thead><tbody id="previewBody"></tbody></table><div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"><button type="submit" id="submitBtn"${args.poolGroups.length === 0 ? " disabled" : ""}>🚀 Import ke Katalog</button><button type="button" id="clearBtn" class="secondary outline">Bersihkan Daftar</button><span id="summaryText"></span></div></div></form>${buildImportScript()}`;
  return shell("import", "import", body);
}
