/**
 * Render a note from `docs/*.md` into a print-ready PDF with headless Chrome,
 * so an incident write-up can be shared as a file instead of a wall of chat.
 *
 *   pnpm note:pdf docs/insiden-2026-11-21-d1-quota.md
 *
 * Supports the markdown subset the notes use: headings, paragraphs, bullets,
 * ordered lists, fenced code blocks, bold, inline code, and `---`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "google-chrome",
  "chrome",
];

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate === undefined || candidate === "") continue;
    if (existsSync(candidate)) return candidate;
    const which = spawnSync(candidate, ["--version"], { encoding: "utf8", shell: false });
    if (which.status === 0) return candidate;
  }
  throw new Error("Chrome/Chromium not found; set CHROME_PATH to its executable.");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline markdown: `code` first, so ** inside code stays literal. */
function inline(text: string): string {
  const spans: string[] = [];
  const tokenized = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    spans.push(`<code>${code}</code>`);
    return `\uE000${String(spans.length - 1)}\uE000`;
  });
  return tokenized
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\uE000(\d+)\uE000/g, (_m, i: string) => spans[Number(i)] ?? "");
}

function renderBlocks(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  const paragraph: string[] = [];
  const list: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  let code: string[] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };
  const flushList = (): void => {
    if (listTag === null || list.length === 0) return;
    out.push(`<${listTag}>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</${listTag}>`);
    list.length = 0;
    listTag = null;
  };

  for (const line of lines) {
    const fence = /^```/.test(line);
    if (code !== null) {
      if (fence) {
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (fence) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      out.push(`<h${String(level)}>${inline(heading[2] ?? "")}</h${String(level)}>`);
      continue;
    }
    if (/^---\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push('<hr>');
      continue;
    }
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet !== null) {
      flushParagraph();
      if (listTag !== "ul") flushList();
      listTag = "ul";
      list.push(bullet[1] ?? "");
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ordered !== null) {
      flushParagraph();
      if (listTag !== "ol") flushList();
      listTag = "ol";
      list.push(ordered[1] ?? "");
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  if (code !== null) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushParagraph();
  flushList();
  return out.join("\n");
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1c1f26; font-family: "Segoe UI", "Inter", system-ui, sans-serif;
  font-size: 10.6pt; line-height: 1.55; }
h1 { font-size: 19pt; line-height: 1.2; margin: 0 0 10pt; }
h2 { font-size: 13.5pt; margin: 20pt 0 7pt; padding-top: 6pt; border-top: 1px solid #d8dbe2; }
h3 { font-size: 11.5pt; margin: 14pt 0 5pt; }
h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin: 0 0 3pt; }
code { font-family: "Cascadia Mono", "Consolas", monospace; font-size: 9.4pt;
  background: #f1f3f7; border-radius: 3pt; padding: 0.5pt 3pt; }
pre { margin: 0 0 9pt; padding: 8pt 10pt; background: #f4f6fa; border: 1px solid #e0e4ec;
  border-radius: 5pt; break-inside: avoid; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
hr { border: none; border-top: 1px solid #e0e4ec; margin: 14pt 0; }
strong { font-weight: 650; }
a { color: #2456c6; text-decoration: none; }
`;

function build(mdPath: string, outPath: string): void {
  const source = readFileSync(mdPath, "utf8");
  const title = /^#\s+(.*)$/m.exec(source)?.[1] ?? "Catatan";
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body>${renderBlocks(source)}</body></html>`;

  const htmlPath = join(tmpdir(), `note-${String(Date.now())}.html`);
  writeFileSync(htmlPath, html, "utf8");
  mkdirSync(dirname(resolve(outPath)), { recursive: true });

  const chrome = findChrome();
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--no-first-run",
    "--virtual-time-budget=3000",
    `--print-to-pdf=${resolve(outPath)}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ];
  const run = spawnSync(chrome, args, { encoding: "utf8" });
  if (run.status !== 0 || !existsSync(outPath)) {
    throw new Error(`Chrome print-to-pdf failed (${String(run.status)}): ${run.stderr ?? ""}`);
  }
  if (statSync(outPath).size < 1024) {
    throw new Error(`PDF looks empty: ${outPath}`);
  }
  console.log(`note: ${mdPath} -> ${outPath} (${String(statSync(outPath).size)} bytes)`);
}

const mdPath = process.argv[2] ?? "docs/insiden-2026-11-21-d1-quota.md";
const name = (mdPath.split(/[\\/]/).pop() ?? "note.md").replace(/\.md$/, "");
build(mdPath, process.argv[3] ?? join("out", `${name}.pdf`));
