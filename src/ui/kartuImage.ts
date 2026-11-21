import {
  deriveBarcodeWidths,
  sanitizeAsciiText,
} from "../domain/kartu.js";
import { getBakedFont, type FontKey } from "./kartuFont.js";

export const KARTU_WIDTH = 640;
export const KARTU_HEIGHT = 384;

export interface DecodedRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface KartuRenderInput {
  readonly userId: string;
  readonly displayName: string;
  readonly username: string;
  readonly nim: string;
  readonly bloodType: string;
  readonly birthInfo: string;
  readonly koleksiText: string;
  readonly joinedText: string;
  readonly jabatanTitle: string;
  readonly jabatanColorHex: string;
  readonly andalanText: string;
  readonly poolFavoritText: string;
  readonly berlakuText?: string;
  readonly avatar?: DecodedRgbaImage | null;
}

function packRgba(r: number, g: number, b: number, a = 255): number {
  return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

export function parseHexColor(hex: string): readonly [number, number, number] {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  if (clean.length !== 6) return [255, 255, 255];
  const n = Number.parseInt(clean, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function blendPixel(
  buf: Uint32Array,
  idx: number,
  r: number,
  g: number,
  b: number,
  alpha255: number,
): void {
  if (alpha255 <= 0) return;
  if (alpha255 >= 255) {
    buf[idx] = packRgba(r, g, b, 255);
    return;
  }
  const dst = buf[idx] ?? 0;
  const dr = dst & 0xff;
  const dg = (dst >>> 8) & 0xff;
  const db = (dst >>> 16) & 0xff;
  const da = (dst >>> 24) & 0xff;
  const inv = 255 - alpha255;
  const nr = (r * alpha255 + dr * inv + 127) >>> 8;
  const ng = (g * alpha255 + dg * inv + 127) >>> 8;
  const nb = (b * alpha255 + db * inv + 127) >>> 8;
  const na = Math.min(255, alpha255 + ((da * inv + 127) >>> 8));
  buf[idx] = packRgba(nr, ng, nb, na);
}

function roundedRectDistance(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): number {
  const cx = Math.max(x + radius, Math.min(x + w - radius, px));
  const cy = Math.max(y + radius, Math.min(y + h - radius, py));
  const dx = px - cx;
  const dy = py - cy;
  const insideCore =
    (px >= x + radius && px <= x + w - radius && py >= y && py <= y + h) ||
    (py >= y + radius && py <= y + h - radius && px >= x && px <= x + w);
  if (insideCore) {
    const distEdge = Math.min(px - x, x + w - px, py - y, y + h - py);
    return -distEdge;
  }
  return Math.hypot(dx, dy) - radius;
}

function drawText(
  buf: Uint32Array,
  fontKey: FontKey,
  text: string,
  x: number,
  y: number,
  rgb: readonly [number, number, number],
  tracking = 0,
): number {
  const font = getBakedFont(fontKey);
  const [r, g, b] = rgb;
  let penX = Math.round(x);
  const baseY = Math.round(y);

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) continue;
    const glyph = font.glyphs[code - 32];
    if (glyph === undefined) continue;
    if (glyph.w > 0 && glyph.h > 0) {
      const gx0 = penX + glyph.dx;
      const gy0 = baseY + glyph.dy;
      let ptr = glyph.offset;
      for (let row = 0; row < glyph.h; row++) {
        const py = gy0 + row;
        if (py < 0 || py >= KARTU_HEIGHT) {
          ptr += glyph.w;
          continue;
        }
        const rowBase = py * KARTU_WIDTH;
        for (let col = 0; col < glyph.w; col++) {
          const nib = font.alphas[ptr++] ?? 0;
          if (nib === 0) continue;
          const px = gx0 + col;
          if (px < 0 || px >= KARTU_WIDTH) continue;
          blendPixel(buf, rowBase + px, r, g, b, nib * 17);
        }
      }
    }
    penX += glyph.advance + tracking;
  }
  return penX - Math.round(x);
}

function measureTextWidth(fontKey: FontKey, text: string, tracking = 0): number {
  const font = getBakedFont(fontKey);
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) continue;
    const glyph = font.glyphs[code - 32];
    if (glyph === undefined) continue;
    width += glyph.advance + (i + 1 < text.length ? tracking : 0);
  }
  return width;
}

function drawFilledRect(
  buf: Uint32Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  alpha = 255,
): void {
  const startX = Math.max(0, Math.floor(x0));
  const endX = Math.min(KARTU_WIDTH, Math.ceil(x0 + w));
  const startY = Math.max(0, Math.floor(y0));
  const endY = Math.min(KARTU_HEIGHT, Math.ceil(y0 + h));
  const packed = packRgba(r, g, b, 255);
  for (let y = startY; y < endY; y++) {
    const rowOffset = y * KARTU_WIDTH;
    if (alpha >= 255) {
      buf.fill(packed, rowOffset + startX, rowOffset + endX);
    } else {
      for (let x = startX; x < endX; x++) {
        blendPixel(buf, rowOffset + x, r, g, b, alpha);
      }
    }
  }
}

function drawSmartChip(
  buf: Uint32Array,
  chipX: number,
  chipY: number,
  chipW: number,
  chipH: number,
): void {
  const radius = 8;
  for (let py = chipY; py < chipY + chipH; py++) {
    const t = (py - chipY) / Math.max(1, chipH - 1);
    const gr = Math.round(234 - t * 30);
    const gg = Math.round(198 - t * 38);
    const gb = Math.round(92 - t * 34);
    for (let px = chipX; px < chipX + chipW; px++) {
      const dist = roundedRectDistance(px + 0.5, py + 0.5, chipX, chipY, chipW, chipH, radius);
      if (dist > 0.75) continue;
      const idx = py * KARTU_WIDTH + px;
      const edgeAlpha = dist > -0.75 ? Math.round((0.75 - dist) * 170) : 255;
      if (dist > -1.8) {
        blendPixel(buf, idx, 138, 103, 24, edgeAlpha);
      } else {
        blendPixel(buf, idx, gr, gg, gb, edgeAlpha);
      }
    }
  }
  // Smartcard contact pad lines
  const lineRgb = [142, 108, 28] as const;
  const col1 = chipX + Math.round(chipW * 0.33);
  const col2 = chipX + Math.round(chipW * 0.67);
  const midY = chipY + Math.round(chipH * 0.5);
  drawFilledRect(buf, col1, chipY + 2, 1, chipH - 4, lineRgb[0], lineRgb[1], lineRgb[2], 210);
  drawFilledRect(buf, col2, chipY + 2, 1, chipH - 4, lineRgb[0], lineRgb[1], lineRgb[2], 210);
  drawFilledRect(buf, chipX + 2, midY, col1 - chipX - 2, 1, lineRgb[0], lineRgb[1], lineRgb[2], 210);
  drawFilledRect(buf, col2, midY, chipX + chipW - col2 - 2, 1, lineRgb[0], lineRgb[1], lineRgb[2], 210);
  drawFilledRect(buf, col1, chipY + 11, col2 - col1, 1, lineRgb[0], lineRgb[1], lineRgb[2], 190);
  drawFilledRect(buf, col1, chipY + chipH - 12, col2 - col1, 1, lineRgb[0], lineRgb[1], lineRgb[2], 190);
}

const AVATAR_CX = 122;
const AVATAR_CY = 194;
const AVATAR_R = 70;

let cachedBaseTemplate: Uint32Array | null = null;

function getBaseTemplate(): Uint32Array {
  if (cachedBaseTemplate !== null) return cachedBaseTemplate;

  const buf = new Uint32Array(KARTU_WIDTH * KARTU_HEIGHT);
  const radius = 22;

  const c1x = 515;
  const c1y = 112;
  const c1r2 = 148 * 148;

  const c2x = 562;
  const c2y = 262;
  const c2r2 = 128 * 128;

  const c3x = 92;
  const c3y = 358;
  const c3r2 = 88 * 88;

  for (let y = 0; y < KARTU_HEIGHT; y++) {
    const ty = y / (KARTU_HEIGHT - 1);
    const rowOffset = y * KARTU_WIDTH;
    for (let x = 0; x < KARTU_WIDTH; x++) {
      const dist = roundedRectDistance(
        x + 0.5,
        y + 0.5,
        0,
        0,
        KARTU_WIDTH,
        KARTU_HEIGHT,
        radius,
      );
      if (dist >= 0.8) continue;

      const tx = x / (KARTU_WIDTH - 1);
      const t = tx * 0.55 + ty * 0.45;
      let r = Math.round(45 + t * 34);
      let g = Math.round(21 + t * 18);
      let b = Math.round(39 + t * 30);

      // Subtle diagonal security lines
      if ((x + y) % 9 === 0) {
        r += 4;
        g += 2;
        b += 4;
      }

      // Decorative translucent circles
      const d1 = (x - c1x) * (x - c1x) + (y - c1y) * (y - c1y);
      if (d1 <= c1r2) {
        r = Math.min(255, r + 22);
        g = Math.min(255, g + 10);
        b = Math.min(255, b + 20);
      }
      const d2 = (x - c2x) * (x - c2x) + (y - c2y) * (y - c2y);
      if (d2 <= c2r2) {
        r = Math.min(255, r + 16);
        g = Math.min(255, g + 7);
        b = Math.min(255, b + 15);
      }
      const d3 = (x - c3x) * (x - c3x) + (y - c3y) * (y - c3y);
      if (d3 <= c3r2) {
        r = Math.min(255, r + 15);
        g = Math.min(255, g + 6);
        b = Math.min(255, b + 14);
      }

      // Subtle inner border highlight
      if (dist > -1.6 && dist <= 0) {
        r = Math.min(255, r + 35);
        g = Math.min(255, g + 16);
        b = Math.min(255, b + 32);
      }

      const alpha =
        dist > -0.8 ? Math.max(0, Math.min(255, Math.round((0.8 - dist) * 160))) : 255;
      buf[rowOffset + x] = packRgba(r, g, b, alpha);
    }
  }

  // Header & subtitle
  drawText(buf, "bold20", "KARTU IDENTITAS", 42, 22, [255, 255, 255], 1);
  drawText(buf, "bold10", "GATCHAWEK", 42, 51, [217, 130, 199], 1);

  // Horizontal divider line
  drawFilledRect(buf, 42, 74, 470, 2, 255, 255, 255, 235);

  // Gold smartcard chip
  drawSmartChip(buf, 532, 22, 66, 46);

  // Static field labels
  const labelColor = [217, 130, 199] as const;
  const col1X = 224;
  const col2X = 440;

  drawText(buf, "bold10", "NIM", col1X, 132, labelColor, 1);
  drawText(buf, "bold10", "GOLONGAN DARAH", col2X, 132, labelColor, 1);

  drawText(buf, "bold10", "TEMPAT / TGL LAHIR", col1X, 178, labelColor, 1);
  drawText(buf, "bold10", "KOLEKSI KARTU", col2X, 178, labelColor, 1);

  drawText(buf, "bold10", "BERGABUNG", col1X, 224, labelColor, 1);
  drawText(buf, "bold10", "JABATAN", col2X, 224, labelColor, 1);

  drawText(buf, "bold10", "ANDALAN UTAMA", col1X, 270, labelColor, 1);
  drawText(buf, "bold10", "POOL TERBANYAK", col2X, 270, labelColor, 1);

  drawText(buf, "bold10", "BERLAKU", 492, 323, labelColor, 1);

  // Avatar outer neon-pink glow & border ring
  const glowMaxR = AVATAR_R + 9;
  for (let py = AVATAR_CY - glowMaxR; py <= AVATAR_CY + glowMaxR; py++) {
    if (py < 0 || py >= KARTU_HEIGHT) continue;
    for (let px = AVATAR_CX - glowMaxR; px <= AVATAR_CX + glowMaxR; px++) {
      if (px < 0 || px >= KARTU_WIDTH) continue;
      const dist = Math.hypot(px - AVATAR_CX, py - AVATAR_CY);
      if (dist >= AVATAR_R + 0.5 && dist <= glowMaxR) {
        const idx = py * KARTU_WIDTH + px;
        if (dist <= AVATAR_R + 2.8) {
          // Crisp light-pink border ring
          blendPixel(buf, idx, 252, 211, 238, 245);
        } else {
          // Soft outer neon pink glow
          const norm = 1 - (dist - (AVATAR_R + 2.8)) / (glowMaxR - (AVATAR_R + 2.8));
          const a = Math.round(norm * norm * 145);
          blendPixel(buf, idx, 244, 114, 182, a);
        }
      }
    }
  }

  cachedBaseTemplate = buf;
  return buf;
}

function drawAvatarCircle(
  buf: Uint32Array,
  avatar: DecodedRgbaImage | null | undefined,
  initialChar: string,
): void {
  const rLimit = AVATAR_R + 1;
  const rOuter2 = (AVATAR_R + 0.6) * (AVATAR_R + 0.6);
  const rInner2 = (AVATAR_R - 0.6) * (AVATAR_R - 0.6);
  const invDiam = 1 / (2 * AVATAR_R);

  for (let py = AVATAR_CY - rLimit; py <= AVATAR_CY + rLimit; py++) {
    if (py < 0 || py >= KARTU_HEIGHT) continue;
    const dy = py - AVATAR_CY;
    const dy2 = dy * dy;
    const rowBase = py * KARTU_WIDTH;
    for (let px = AVATAR_CX - rLimit; px <= AVATAR_CX + rLimit; px++) {
      if (px < 0 || px >= KARTU_WIDTH) continue;
      const dx = px - AVATAR_CX;
      const d2 = dx * dx + dy2;
      if (d2 > rOuter2) continue;
      const edgeAlpha =
        d2 > rInner2
          ? Math.max(
              0,
              Math.min(255, Math.round((AVATAR_R + 0.6 - Math.sqrt(d2)) * 212)),
            )
          : 255;

      const idx = rowBase + px;
      if (avatar !== undefined && avatar !== null && avatar.width > 0 && avatar.height > 0) {
        // Cover-crop sample from avatar
        const u = (dx + AVATAR_R) * invDiam;
        const v = (dy + AVATAR_R) * invDiam;
        const side = Math.min(avatar.width, avatar.height);
        const ox = (avatar.width - side) * 0.5;
        const oy = (avatar.height - side) * 0.5;
        const sx = Math.max(
          0,
          Math.min(avatar.width - 1, (ox + u * side) | 0),
        );
        const sy = Math.max(
          0,
          Math.min(avatar.height - 1, (oy + v * side) | 0),
        );
        const pOff = (sy * avatar.width + sx) * 4;
        const sr = avatar.data[pOff] ?? 70;
        const sg = avatar.data[pOff + 1] ?? 35;
        const sb = avatar.data[pOff + 2] ?? 65;
        const sa = avatar.data[pOff + 3] ?? 255;
        const baseR = 64;
        const baseG = 30;
        const baseB = 58;
        const cr = (sr * sa + baseR * (255 - sa)) >>> 8;
        const cg = (sg * sa + baseG * (255 - sa)) >>> 8;
        const cb = (sb * sa + baseB * (255 - sa)) >>> 8;
        blendPixel(buf, idx, cr, cg, cb, edgeAlpha);
      } else {
        // Stylized fallback silhouette avatar
        const t = (dy + AVATAR_R) * invDiam;
        let r = (92 - t * 28) | 0;
        let g = (44 - t * 14) | 0;
        let b = (84 - t * 24) | 0;
        const headD2 = dx * dx + (dy + 16) * (dy + 16);
        const bodyDx = dx * 0.78;
        const bodyDy = dy - 46;
        const bodyD2 = bodyDx * bodyDx + bodyDy * bodyDy;
        if (headD2 <= 21 * 21 || (dy > 14 && bodyD2 <= 42 * 42)) {
          r = 216;
          g = 150;
          b = 202;
        }
        blendPixel(buf, idx, r, g, b, edgeAlpha);
      }
    }
  }

  if (avatar === undefined || avatar === null) {
    const ch = initialChar.slice(0, 1).toUpperCase();
    const w = measureTextWidth("bold20", ch, 0);
    drawText(
      buf,
      "bold20",
      ch,
      AVATAR_CX - Math.round(w / 2),
      AVATAR_CY - 28,
      [55, 22, 48],
      0,
    );
  }
}

function drawBarcode(buf: Uint32Array, userId: string): void {
  const startX = 224;
  const startY = 320;
  const height = 38;
  const widths = deriveBarcodeWidths(userId, 252);
  let curX = startX;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] ?? 1;
    const isBar = i % 2 === 0;
    if (isBar) {
      drawFilledRect(buf, curX, startY, w, height, 250, 245, 252, 248);
    } else {
      drawFilledRect(buf, curX, startY, w, height, 34, 14, 30, 225);
    }
    curX += w;
  }
}

export function renderKartuPixels(input: KartuRenderInput): Uint32Array {
  const buf = new Uint32Array(getBaseTemplate());

  const cleanDisplayName = sanitizeAsciiText(input.displayName, 20);
  const rawHandle = input.username.startsWith("@")
    ? input.username
    : `@${input.username}`;
  const cleanHandle = sanitizeAsciiText(rawHandle, 20);

  drawAvatarCircle(buf, input.avatar, cleanDisplayName);

  // Centered @username below avatar
  const handleW = measureTextWidth("reg13", cleanHandle, 0);
  drawText(
    buf,
    "reg13",
    cleanHandle,
    AVATAR_CX - Math.round(handleW / 2),
    281,
    [232, 208, 226],
    0,
  );

  // Display name header on the right
  drawText(buf, "bold26", cleanDisplayName, 224, 88, [255, 255, 255], 0);

  const white = [255, 255, 255] as const;
  const col1X = 224;
  const col2X = 440;

  // Row 1: NIM | GOLONGAN DARAH
  drawText(buf, "reg15", sanitizeAsciiText(input.nim, 18), col1X, 147, white, 0);
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.bloodType, 10),
    col2X,
    147,
    white,
    0,
  );

  // Row 2: TEMPAT / TGL LAHIR | KOLEKSI KARTU
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.birthInfo, 24),
    col1X,
    193,
    white,
    0,
  );
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.koleksiText, 22),
    col2X,
    193,
    white,
    0,
  );

  // Row 3: BERGABUNG | JABATAN
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.joinedText, 22),
    col1X,
    239,
    white,
    0,
  );
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.jabatanTitle, 20),
    col2X,
    239,
    parseHexColor(input.jabatanColorHex),
    0,
  );

  // Row 4: ANDALAN UTAMA | POOL TERBANYAK
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.andalanText, 24),
    col1X,
    285,
    white,
    0,
  );
  drawText(
    buf,
    "reg15",
    sanitizeAsciiText(input.poolFavoritText, 20),
    col2X,
    285,
    white,
    0,
  );

  // Bottom row: Barcode + BERLAKU
  drawBarcode(buf, input.userId);
  drawText(
    buf,
    "reg13",
    sanitizeAsciiText(input.berlakuText ?? "Seumur Hidup", 16),
    492,
    338,
    white,
    0,
  );

  return buf;
}

// --- Fast PNG Encoder & Decoder (using native Web CompressionStream/DecompressionStream) ---

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(typeBytes: Uint8Array, data: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < typeBytes.length; i++) {
    c = (table[(c ^ (typeBytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    c = (table[(c ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU32BE(out: Uint8Array, offset: number, val: number): void {
  out[offset] = (val >>> 24) & 0xff;
  out[offset + 1] = (val >>> 16) & 0xff;
  out[offset + 2] = (val >>> 8) & 0xff;
  out[offset + 3] = val & 0xff;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    (((buf[offset] ?? 0) << 24) |
      ((buf[offset + 1] ?? 0) << 16) |
      ((buf[offset + 2] ?? 0) << 8) |
      (buf[offset + 3] ?? 0)) >>>
    0
  );
}

async function runStream(
  input: Uint8Array,
  transform: ReadableWritablePair<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  void writer.write(input);
  void writer.close();
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    merged.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return merged;
}

function makeChunk(typeAscii: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = typeAscii.charCodeAt(i);
  const out = new Uint8Array(12 + data.byteLength);
  writeU32BE(out, 0, data.byteLength);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeU32BE(out, 8 + data.byteLength, crc32(typeBytes, data));
  return out;
}

export async function encodeRgbaToPng(
  pixels: Uint32Array,
  width = KARTU_WIDTH,
  height = KARTU_HEIGHT,
): Promise<Uint8Array> {
  const rowBytes = width * 4;
  const stride = rowBytes + 1;
  const rawBytes = new Uint8Array(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength,
  );
  const scanlines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const srcOff = y * rowBytes;
    const dstOff = y * stride;
    scanlines[dstOff] = 0; // Filter type 0 (None)
    scanlines.set(rawBytes.subarray(srcOff, srcOff + rowBytes), dstOff + 1);
  }

  const compressed = await runStream(
    scanlines,
    new CompressionStream("deflate") as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >,
  );

  const ihdrData = new Uint8Array(13);
  writeU32BE(ihdrData, 0, width);
  writeU32BE(ihdrData, 4, height);
  ihdrData[8] = 8; // bit depth 8
  ihdrData[9] = 6; // color type 6 (RGBA)
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = makeChunk("IHDR", ihdrData);
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(
    signature.byteLength + ihdr.byteLength + idat.byteLength + iend.byteLength,
  );
  let offset = 0;
  png.set(signature, offset);
  offset += signature.byteLength;
  png.set(ihdr, offset);
  offset += ihdr.byteLength;
  png.set(idat, offset);
  offset += idat.byteLength;
  png.set(iend, offset);
  return png;
}

export async function renderKartuPng(
  input: KartuRenderInput,
): Promise<Uint8Array> {
  const pixels = renderKartuPixels(input);
  return encodeRgbaToPng(pixels, KARTU_WIDTH, KARTU_HEIGHT);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes standard non-interlaced 8-bit PNG (RGB, RGBA, Grayscale, or Indexed Palette)
 * returned by Discord's avatar CDN into RGBA pixels. Returns null on unsupported/corrupt input.
 */
export async function decodePngToRgba(
  pngBytes: Uint8Array,
): Promise<DecodedRgbaImage | null> {
  try {
    if (pngBytes.byteLength < 33) return null;
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
      if (pngBytes[i] !== sig[i]) return null;
    }

    let pos = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Uint8Array | null = null;
    let trns: Uint8Array | null = null;
    const idatParts: Uint8Array[] = [];
    let idatTotal = 0;

    while (pos + 8 <= pngBytes.byteLength) {
      const len = readU32BE(pngBytes, pos);
      const type = String.fromCharCode(
        pngBytes[pos + 4] ?? 0,
        pngBytes[pos + 5] ?? 0,
        pngBytes[pos + 6] ?? 0,
        pngBytes[pos + 7] ?? 0,
      );
      const dataStart = pos + 8;
      const dataEnd = dataStart + len;
      if (dataEnd + 4 > pngBytes.byteLength) return null;
      const chunk = pngBytes.subarray(dataStart, dataEnd);

      if (type === "IHDR") {
        width = readU32BE(chunk, 0);
        height = readU32BE(chunk, 4);
        bitDepth = chunk[8] ?? 0;
        colorType = chunk[9] ?? 0;
        interlace = chunk[12] ?? 0;
      } else if (type === "PLTE") {
        palette = chunk;
      } else if (type === "tRNS") {
        trns = chunk;
      } else if (type === "IDAT") {
        idatParts.push(chunk);
        idatTotal += chunk.byteLength;
      } else if (type === "IEND") {
        break;
      }
      pos = dataEnd + 4;
    }

    if (
      width <= 0 ||
      height <= 0 ||
      width > 1024 ||
      height > 1024 ||
      bitDepth !== 8 ||
      interlace !== 0 ||
      idatTotal === 0
    ) {
      return null;
    }

    const bpp =
      colorType === 6
        ? 4
        : colorType === 2
          ? 3
          : colorType === 4
            ? 2
            : colorType === 0 || colorType === 3
              ? 1
              : 0;
    if (bpp === 0) return null;

    const mergedIdat = new Uint8Array(idatTotal);
    let offset = 0;
    for (const part of idatParts) {
      mergedIdat.set(part, offset);
      offset += part.byteLength;
    }

    const inflated = await runStream(
      mergedIdat,
      new DecompressionStream("deflate") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );

    const rowBytes = width * bpp;
    const stride = rowBytes + 1;
    if (inflated.byteLength < stride * height) return null;

    const unfiltered = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const filter = inflated[y * stride] ?? 0;
      const srcRow = y * stride + 1;
      const dstRow = y * rowBytes;
      const prevRow = (y - 1) * rowBytes;

      for (let i = 0; i < rowBytes; i++) {
        const raw = inflated[srcRow + i] ?? 0;
        const a = i >= bpp ? (unfiltered[dstRow + i - bpp] ?? 0) : 0;
        const b = y > 0 ? (unfiltered[prevRow + i] ?? 0) : 0;
        const c = y > 0 && i >= bpp ? (unfiltered[prevRow + i - bpp] ?? 0) : 0;
        let val = raw;
        if (filter === 1) val = (raw + a) & 0xff;
        else if (filter === 2) val = (raw + b) & 0xff;
        else if (filter === 3) val = (raw + ((a + b) >>> 1)) & 0xff;
        else if (filter === 4) val = (raw + paethPredictor(a, b, c)) & 0xff;
        unfiltered[dstRow + i] = val;
      }
    }

    const rgba = new Uint8Array(width * height * 4);
    const totalPixels = width * height;
    if (colorType === 6) {
      rgba.set(unfiltered.subarray(0, rgba.byteLength));
    } else if (colorType === 2) {
      for (let p = 0; p < totalPixels; p++) {
        rgba[p * 4] = unfiltered[p * 3] ?? 0;
        rgba[p * 4 + 1] = unfiltered[p * 3 + 1] ?? 0;
        rgba[p * 4 + 2] = unfiltered[p * 3 + 2] ?? 0;
        rgba[p * 4 + 3] = 255;
      }
    } else if (colorType === 3 && palette !== null) {
      for (let p = 0; p < totalPixels; p++) {
        const idx = unfiltered[p] ?? 0;
        rgba[p * 4] = palette[idx * 3] ?? 0;
        rgba[p * 4 + 1] = palette[idx * 3 + 1] ?? 0;
        rgba[p * 4 + 2] = palette[idx * 3 + 2] ?? 0;
        rgba[p * 4 + 3] = trns !== null && idx < trns.length ? (trns[idx] ?? 255) : 255;
      }
    } else if (colorType === 0) {
      for (let p = 0; p < totalPixels; p++) {
        const v = unfiltered[p] ?? 0;
        rgba[p * 4] = v;
        rgba[p * 4 + 1] = v;
        rgba[p * 4 + 2] = v;
        rgba[p * 4 + 3] = 255;
      }
    } else if (colorType === 4) {
      for (let p = 0; p < totalPixels; p++) {
        const v = unfiltered[p * 2] ?? 0;
        rgba[p * 4] = v;
        rgba[p * 4 + 1] = v;
        rgba[p * 4 + 2] = v;
        rgba[p * 4 + 3] = unfiltered[p * 2 + 1] ?? 255;
      }
    } else {
      return null;
    }

    return { width, height, data: rgba };
  } catch {
    return null;
  }
}
