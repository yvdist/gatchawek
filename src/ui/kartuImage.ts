import {
  deriveBarcodeWidths,
  deriveCardTheme,
  sanitizeAsciiText,
  type CardTheme,
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

interface CardShapeMask {
  readonly alpha: Uint8Array;
  readonly isBorder: Uint8Array;
}

let cachedShapeMask: CardShapeMask | null = null;

function getCardShapeMask(): CardShapeMask {
  if (cachedShapeMask !== null) return cachedShapeMask;
  const total = KARTU_WIDTH * KARTU_HEIGHT;
  const alpha = new Uint8Array(total);
  const isBorder = new Uint8Array(total);
  const radius = 22;

  for (let y = 0; y < KARTU_HEIGHT; y++) {
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
      const a =
        dist > -0.8 ? Math.max(1, Math.min(255, Math.round((0.8 - dist) * 160))) : 255;
      alpha[rowOffset + x] = a;
      if (dist > -1.8 && dist <= 0) {
        isBorder[rowOffset + x] = 1;
      }
    }
  }
  cachedShapeMask = { alpha, isBorder };
  return cachedShapeMask;
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
      const dist = roundedRectDistance(
        px + 0.5,
        py + 0.5,
        chipX,
        chipY,
        chipW,
        chipH,
        radius,
      );
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

function renderUniqueBackground(buf: Uint32Array, theme: CardTheme): void {
  const mask = getCardShapeMask();
  const [sR, sG, sB] = theme.bgStartRgb;
  const [eR, eG, eB] = theme.bgEndRgb;
  const [tR, tG, tB] = theme.shapeTintRgb;
  const [aR, aG, aB] = theme.accentLineRgb;

  const dR = eR - sR;
  const dG = eG - sG;
  const dB = eB - sB;

  const { seedA, seedB, seedC, motif, gradientMode } = theme;

  const p1x = 420 + (seedA % 180);
  const p1y = 60 + ((seedA >>> 8) % 120);
  const p1r = 115 + ((seedA >>> 16) % 50);
  const p1r2 = p1r * p1r;

  const p2x = 470 + (seedB % 140);
  const p2y = 210 + ((seedB >>> 8) % 130);
  const p2r = 100 + ((seedB >>> 16) % 45);
  const p2r2 = p2r * p2r;

  const p3x = 45 + (seedC % 130);
  const p3y = 290 + ((seedC >>> 8) % 85);
  const p3r = 75 + ((seedC >>> 16) % 40);
  const p3r2 = p3r * p3r;

  const wave1 = new Int16Array(KARTU_WIDTH);
  const wave2 = new Int16Array(KARTU_WIDTH);
  const wave3 = new Int16Array(KARTU_WIDTH);
  if (motif === "topographic-waves") {
    const freq1 = 0.008 + (seedA & 0x1f) * 0.00025;
    const freq2 = 0.011 + (seedB & 0x1f) * 0.00025;
    const phase1 = (seedA >>> 5) & 0xff;
    const phase2 = (seedB >>> 5) & 0xff;
    const amp1 = 24 + ((seedA >>> 13) % 22);
    const amp2 = 20 + ((seedB >>> 13) % 20);
    for (let x = 0; x < KARTU_WIDTH; x++) {
      wave1[x] = Math.round(135 + Math.sin(x * freq1 + phase1) * amp1);
      wave2[x] = Math.round(230 + Math.cos(x * freq2 + phase2) * amp2);
      wave3[x] = Math.round(
        310 + Math.sin(x * (freq1 * 0.85) + phase2) * (amp1 * 0.75),
      );
    }
  }

  const chevSlopeDir = (seedA & 1) === 0 ? 1 : -1;
  const chevBand1 = 360 + (seedA % 160);
  const chevBand2 = 540 + (seedB % 160);
  const chevBand3 = 170 + (seedC % 110);

  const gridStep = 34 + (seedA % 14);
  const gridOffX = (seedB >>> 4) % gridStep;
  const gridOffY = (seedC >>> 4) % gridStep;

  const gradX = new Int32Array(KARTU_WIDTH);
  const gradY = new Int32Array(KARTU_HEIGHT);
  const wWeight =
    gradientMode === 0
      ? 148
      : gradientMode === 1
        ? 140
        : gradientMode === 2
          ? 128
          : 90;
  const hWeight = 256 - wWeight;
  for (let x = 0; x < KARTU_WIDTH; x++) {
    const u = gradientMode === 2 ? KARTU_WIDTH - 1 - x : x;
    gradX[x] = ((u * wWeight) / (KARTU_WIDTH - 1)) | 0;
  }
  for (let y = 0; y < KARTU_HEIGHT; y++) {
    const v = gradientMode === 1 ? KARTU_HEIGHT - 1 - y : y;
    gradY[y] = ((v * hWeight) / (KARTU_HEIGHT - 1)) | 0;
  }

  const motifId =
    motif === "orbital-spheres"
      ? 0
      : motif === "cyber-chevrons"
        ? 1
        : motif === "topographic-waves"
          ? 2
          : motif === "diamond-prism"
            ? 3
            : motif === "sunburst-rays"
              ? 4
              : 5;

  const p1RingBand = p1r * 3;
  const p2RingR = p2r + 28;
  const p2RingR2 = p2RingR * p2RingR;
  const p2RingBand = p2RingR * 2;
  const haloR2 = (p1r + 50) * (p1r + 50);
  const raySeed = seedA & 7;

  for (let y = 0; y < KARTU_HEIGHT; y += 2) {
    const gyVal = gradY[y] ?? 0;
    const row0 = y * KARTU_WIDTH;
    const row1 = (y + 1) * KARTU_WIDTH;
    const dy1 = y - p1y;
    const dy1Sq = dy1 * dy1;
    const dy1Abs = dy1 < 0 ? -dy1 : dy1;
    const dy2 = y - p2y;
    const dy2Sq = dy2 * dy2;
    const dy2Abs = dy2 < 0 ? -dy2 : dy2;
    const dy3 = y - p3y;
    const dy3Sq = dy3 * dy3;
    const dy3Abs = dy3 < 0 ? -dy3 : dy3;
    const chevY = chevSlopeDir > 0 ? y : KARTU_HEIGHT - y;
    const hexGy = (y + gridOffY) % gridStep;

    for (let x = 0; x < KARTU_WIDTH; x += 2) {
      const t256 = (gradX[x] ?? 0) + gyVal;
      let r = sR + ((dR * t256) >> 8);
      let g = sG + ((dG * t256) >> 8);
      let b = sB + ((dB * t256) >> 8);

      if (motifId === 0) {
        if (((x + y) & 7) === 0) {
          r += 4;
          g += 3;
          b += 4;
        }
        const dx1 = x - p1x;
        const d1 = dx1 * dx1 + dy1Sq;
        if (d1 <= p1r2) {
          r += tR;
          g += tG;
          b += tB;
        }
        const diff1 = d1 - p1r2;
        if ((diff1 < 0 ? -diff1 : diff1) <= p1RingBand) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
        const dx2 = x - p2x;
        const d2 = dx2 * dx2 + dy2Sq;
        if (d2 <= p2r2) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
        }
        const dx3 = x - p3x;
        const d3 = dx3 * dx3 + dy3Sq;
        if (d3 <= p3r2) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
        }
        const diff2 = d2 - p2RingR2;
        if ((diff2 < 0 ? -diff2 : diff2) <= p2RingBand) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
      } else if (motifId === 1) {
        const diag = x + chevY;
        const raw1 = diag - chevBand1;
        const dist1 = raw1 < 0 ? -raw1 : raw1;
        const raw2 = diag - chevBand2;
        const dist2 = raw2 < 0 ? -raw2 : raw2;
        const raw3 = x - y - chevBand3;
        const dist3 = raw3 < 0 ? -raw3 : raw3;
        if (dist1 < 46) {
          r += tR;
          g += tG;
          b += tB;
          if (dist1 >= 42) {
            r = (r * 3 + aR) >> 2;
            g = (g * 3 + aG) >> 2;
            b = (b * 3 + aB) >> 2;
          }
        }
        if (dist2 < 32) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
          if (dist2 >= 28) {
            r = (r * 3 + aR) >> 2;
            g = (g * 3 + aG) >> 2;
            b = (b * 3 + aB) >> 2;
          }
        }
        if (dist3 < 20) {
          r += tR >> 1;
          g += tG >> 1;
          b += tB >> 1;
        }
        if ((x & 15) === 0 && (y & 15) === 0) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
      } else if (motifId === 2) {
        const w1 = wave1[x] ?? 140;
        const w2 = wave2[x] ?? 230;
        const w3 = wave3[x] ?? 310;
        if (y >= w1) {
          r += tR >> 1;
          g += tG >> 1;
          b += tB >> 1;
        }
        if (y >= w2) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
        }
        if (y >= w3) {
          r += tR >> 1;
          g += tG >> 1;
          b += tB >> 1;
        }
        const dw1 = y >= w1 ? y - w1 : w1 - y;
        const dw2 = y >= w2 ? y - w2 : w2 - y;
        const dw3 = y >= w3 ? y - w3 : w3 - y;
        if (dw1 <= 2 || dw2 <= 2 || dw3 <= 2) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        } else if (dw1 % 22 <= 1) {
          r += 8;
          g += 8;
          b += 8;
        }
      } else if (motifId === 3) {
        const dx1 = x >= p1x ? x - p1x : p1x - x;
        const dx2 = x >= p2x ? x - p2x : p2x - x;
        const dx3 = x >= p3x ? x - p3x : p3x - x;
        const m1 = dx1 + dy1Abs;
        const m2 = dx2 + dy2Abs;
        const m3 = dx3 + dy3Abs;
        if (m1 <= p1r) {
          r += tR;
          g += tG;
          b += tB;
        }
        if (
          (m1 >= p1r - 2 && m1 <= p1r + 2) ||
          (m1 >= p1r + 20 && m1 <= p1r + 24)
        ) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
        if (m2 <= p2r) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
        }
        if (m2 >= p2r - 2 && m2 <= p2r + 2) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
        if (m3 <= p3r) {
          r += tR >> 1;
          g += tG >> 1;
          b += tB >> 1;
        }
        if (((x + y) & 22) === 0 || ((x - y + 1024) & 22) === 0) {
          r += 5;
          g += 5;
          b += 5;
        }
      } else if (motifId === 4) {
        const dx = x - p1x;
        const d2 = dx * dx + dy1Sq;
        const ax = dx < 0 ? -dx : dx;
        const ay = dy1Abs;
        const sector =
          ((dx >= 0 ? 1 : 0) << 3) |
          ((dy1 >= 0 ? 1 : 0) << 2) |
          ((ax > ay ? 1 : 0) << 1) |
          (ax > ay * 2 || ay > ax * 2 ? 1 : 0);
        if (((sector + raySeed) & 1) === 0) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
        }
        if (d2 <= p1r2) {
          r += tR >> 1;
          g += tG >> 1;
          b += tB >> 1;
        }
        const diffA = d2 - p1r2;
        const diffB = d2 - haloR2;
        if (
          (diffA < 0 ? -diffA : diffA) <= p1RingBand ||
          (diffB < 0 ? -diffB : diffB) <= p1RingBand
        ) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
        if ((y & 3) === 0) {
          r += 4;
          g += 4;
          b += 4;
        }
      } else {
        const gx = (x + gridOffX) % gridStep;
        if (gx <= 1 || hexGy <= 1) {
          r += 7;
          g += 7;
          b += 7;
        }
        if (gx <= 3 && hexGy <= 3) {
          r = (r * 3 + aR) >> 2;
          g = (g * 3 + aG) >> 2;
          b = (b * 3 + aB) >> 2;
        }
        const dx1 = x - p1x;
        const dx3 = x - p3x;
        if (dx1 * dx1 + dy1Sq <= p1r2 || dx3 * dx3 + dy3Sq <= p3r2) {
          r += (tR * 3) >> 2;
          g += (tG * 3) >> 2;
          b += (tB * 3) >> 2;
        }
        const band = x - y - 240;
        if ((band < 0 ? -band : band) < 28) {
          r += tR >> 1;
          g += tG >> 1;
          b += tB >> 1;
        }
      }

      const cr = r > 255 ? 255 : r < 0 ? 0 : r | 0;
      const cg = g > 255 ? 255 : g < 0 ? 0 : g | 0;
      const cb = b > 255 ? 255 : b < 0 ? 0 : b | 0;
      const packed = packRgba(cr, cg, cb, 255);
      buf[row0 + x] = packed;
      buf[row0 + x + 1] = packed;
      buf[row1 + x] = packed;
      buf[row1 + x + 1] = packed;
    }
  }

  // Apply crisp 1px rounded corner alpha mask only on the 4 corner 26x26 boxes
  const cornerBoxes = [
    [0, 26, 0, 26],
    [KARTU_WIDTH - 26, KARTU_WIDTH, 0, 26],
    [0, 26, KARTU_HEIGHT - 26, KARTU_HEIGHT],
    [KARTU_WIDTH - 26, KARTU_WIDTH, KARTU_HEIGHT - 26, KARTU_HEIGHT],
  ] as const;
  for (const [xStart, xEnd, yStart, yEnd] of cornerBoxes) {
    for (let y = yStart; y < yEnd; y++) {
      const rowOff = y * KARTU_WIDTH;
      for (let x = xStart; x < xEnd; x++) {
        const idx = rowOff + x;
        const a = mask.alpha[idx] ?? 0;
        if (a === 0) {
          buf[idx] = 0;
        } else if (a < 255) {
          buf[idx] = ((buf[idx] ?? 0) & 0x00ffffff) | (a << 24);
        }
      }
    }
  }
}

function drawAvatarRingAndCircle(
  buf: Uint32Array,
  theme: CardTheme,
  avatar: DecodedRgbaImage | null | undefined,
  initialChar: string,
): void {
  const [ringR, ringG, ringB] = theme.ringRgb;
  const [glowR, glowG, glowB] = theme.glowRgb;
  const [bgR, bgG, bgB] = theme.bgEndRgb;

  const glowMaxR = AVATAR_R + 9;
  const glowMaxR2 = glowMaxR * glowMaxR;
  const rOuter2 = (AVATAR_R + 0.6) * (AVATAR_R + 0.6);
  const rInner2 = (AVATAR_R - 0.6) * (AVATAR_R - 0.6);
  const ringBorderR = AVATAR_R + 2.8;
  const invDiam = 1 / (2 * AVATAR_R);

  for (let py = AVATAR_CY - glowMaxR; py <= AVATAR_CY + glowMaxR; py++) {
    if (py < 0 || py >= KARTU_HEIGHT) continue;
    const dy = py - AVATAR_CY;
    const dy2 = dy * dy;
    const rowBase = py * KARTU_WIDTH;

    for (let px = AVATAR_CX - glowMaxR; px <= AVATAR_CX + glowMaxR; px++) {
      if (px < 0 || px >= KARTU_WIDTH) continue;
      const dx = px - AVATAR_CX;
      const d2 = dx * dx + dy2;
      if (d2 > glowMaxR2) continue;

      const idx = rowBase + px;

      if (d2 <= rOuter2) {
        const edgeAlpha =
          d2 > rInner2
            ? Math.max(
                0,
                Math.min(
                  255,
                  Math.round((AVATAR_R + 0.6 - Math.sqrt(d2)) * 212),
                ),
              )
            : 255;

        if (
          avatar !== undefined &&
          avatar !== null &&
          avatar.width > 0 &&
          avatar.height > 0
        ) {
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
          const sr = avatar.data[pOff] ?? bgR;
          const sg = avatar.data[pOff + 1] ?? bgG;
          const sb = avatar.data[pOff + 2] ?? bgB;
          const sa = avatar.data[pOff + 3] ?? 255;
          const cr = (sr * sa + bgR * (255 - sa)) >>> 8;
          const cg = (sg * sa + bgG * (255 - sa)) >>> 8;
          const cb = (sb * sa + bgB * (255 - sa)) >>> 8;
          blendPixel(buf, idx, cr, cg, cb, edgeAlpha);
        } else {
          const t = (dy + AVATAR_R) * invDiam;
          let r = Math.min(255, (bgR + 24 - t * 22) | 0);
          let g = Math.min(255, (bgG + 20 - t * 18) | 0);
          let b = Math.min(255, (bgB + 24 - t * 22) | 0);
          const headD2 = dx * dx + (dy + 16) * (dy + 16);
          const bodyDx = dx * 0.78;
          const bodyDy = dy - 46;
          const bodyD2 = bodyDx * bodyDx + bodyDy * bodyDy;
          if (headD2 <= 21 * 21 || (dy > 14 && bodyD2 <= 42 * 42)) {
            r = theme.labelRgb[0];
            g = theme.labelRgb[1];
            b = theme.labelRgb[2];
          }
          blendPixel(buf, idx, r, g, b, edgeAlpha);
        }
      }

      if (d2 >= (AVATAR_R - 0.5) * (AVATAR_R - 0.5)) {
        const dist = Math.sqrt(d2);
        if (dist >= AVATAR_R + 0.2 && dist <= ringBorderR) {
          blendPixel(buf, idx, ringR, ringG, ringB, 245);
        } else if (dist > ringBorderR && dist <= glowMaxR) {
          const norm = 1 - (dist - ringBorderR) / (glowMaxR - ringBorderR);
          const a = Math.round(norm * norm * 150);
          blendPixel(buf, idx, glowR, glowG, glowB, a);
        }
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
      theme.bgStartRgb,
      0,
    );
  }
}

function drawBarcode(
  buf: Uint32Array,
  userId: string,
  darkRgb: readonly [number, number, number],
): void {
  const startX = 224;
  const startY = 320;
  const height = 38;
  const widths = deriveBarcodeWidths(userId, 252);
  let curX = startX;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] ?? 1;
    const isBar = i % 2 === 0;
    if (isBar) {
      drawFilledRect(buf, curX, startY, w, height, 250, 248, 252, 248);
    } else {
      drawFilledRect(
        buf,
        curX,
        startY,
        w,
        height,
        darkRgb[0],
        darkRgb[1],
        darkRgb[2],
        225,
      );
    }
    curX += w;
  }
}

const USER_TEMPLATE_CACHE_MAX = 8;
const userTemplateCache = new Map<string, Uint32Array>();

function getUserBaseTemplate(userId: string, theme: CardTheme): Uint32Array {
  const existing = userTemplateCache.get(userId);
  if (existing !== undefined) return existing;

  const buf = new Uint32Array(KARTU_WIDTH * KARTU_HEIGHT);

  renderUniqueBackground(buf, theme);

  drawText(buf, "bold20", "KARTU IDENTITAS", 42, 22, [255, 255, 255], 1);
  drawText(buf, "bold10", "GATCHAWEK", 42, 51, theme.labelRgb, 1);

  drawFilledRect(buf, 42, 74, 470, 2, 255, 255, 255, 235);
  drawFilledRect(
    buf,
    42,
    76,
    180,
    1,
    theme.accentLineRgb[0],
    theme.accentLineRgb[1],
    theme.accentLineRgb[2],
    180,
  );

  drawSmartChip(buf, 532, 22, 66, 46);

  const labelColor = theme.labelRgb;
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

  drawBarcode(buf, userId, theme.bgStartRgb);

  if (userTemplateCache.size >= USER_TEMPLATE_CACHE_MAX) {
    const oldestKey = userTemplateCache.keys().next().value;
    if (oldestKey !== undefined) userTemplateCache.delete(oldestKey);
  }
  userTemplateCache.set(userId, buf);
  return buf;
}

export function renderKartuPixels(input: KartuRenderInput): Uint32Array {
  const theme = deriveCardTheme(input.userId);
  const buf = new Uint32Array(getUserBaseTemplate(input.userId, theme));

  const col1X = 224;
  const col2X = 440;

  const cleanDisplayName = sanitizeAsciiText(input.displayName, 20);
  const rawHandle = input.username.startsWith("@")
    ? input.username
    : `@${input.username}`;
  const cleanHandle = sanitizeAsciiText(rawHandle, 20);

  drawAvatarRingAndCircle(buf, theme, input.avatar, cleanDisplayName);

  const handleW = measureTextWidth("reg13", cleanHandle, 0);
  drawText(
    buf,
    "reg13",
    cleanHandle,
    AVATAR_CX - Math.round(handleW / 2),
    281,
    theme.handleRgb,
    0,
  );

  drawText(buf, "bold26", cleanDisplayName, 224, 88, [255, 255, 255], 0);

  const white = [255, 255, 255] as const;

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
    scanlines[dstOff] = 0;
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
  ihdrData[8] = 8;
  ihdrData[9] = 6;
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
        rgba[p * 4 + 3] =
          trns !== null && idx < trns.length ? (trns[idx] ?? 255) : 255;
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
