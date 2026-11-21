import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import * as gifencNamespace from "gifenc";
import gifencDefault from "gifenc";
interface GifencEncoder {
  writeFrame(
    index: Uint8Array,
    width: number,
    height: number,
    opts: {
      palette?: number[][] | null;
      delay?: number;
      repeat?: number;
      transparent?: boolean;
      transparentIndex?: number;
      dispose?: number;
    },
  ): void;
  finish(): void;
  bytesView(): Uint8Array;
}
interface GifencApi {
  GIFEncoder: (opts?: { initialCapacity?: number; auto?: boolean }) => GifencEncoder;
  quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: string; oneBitAlpha?: boolean | number }): number[][];
  applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
// gifenc ships no "exports" map: tsx/node resolve main (CJS) while vitest
// resolves module (ESM). Normalize both shapes to the real API object.
const gifencApi = (typeof (gifencNamespace as unknown as { GIFEncoder?: unknown }).GIFEncoder === "function"
  ? (gifencNamespace as unknown as GifencApi)
  : (gifencDefault as unknown as GifencApi));
const { applyPalette, GIFEncoder, quantize } = gifencApi;

export const CARD_W = 600;
export const CARD_H = 900;
export const ANIM_W = 400;
export const ANIM_H = 600;
const ANIM_FRAMES = 12;
const ANIM_DELAY_MS = 75;
const RADIUS = 36;
const BORDER = 14;

export function isAnimatedRarity(rarity: string): boolean {
  return rarity === "holo" || rarity === "secret";
}

export function cardFileExtension(rarity: string): "gif" | "webp" {
  return isAnimatedRarity(rarity) ? "gif" : "webp";
}

export interface CardInput {
  cardId: string;
  badge: string;
  memberName: string;
  photoLabel: string | null;
  fullName: string | null;
  rarity: string;
  serial: number;
  photoNo: number;
  photoTotal: number;
  rawPath: string;
  focusX: number;
  focusY: number;
}

interface TierStyle {
  label: string;
  stars: string;
  stops: string[];
  accent: string;
  accent2: string;
  glow: string;
  sheenStops: string[];
  sheenAlpha: number;
}

const DEFAULT_TIER: TierStyle = {
  label: "Common",
  stars: "★",
  stops: ["#475569", "#CBD5E1", "#F8FAFC", "#94A3B8", "#334155"],
  accent: "#E2E8F0",
  accent2: "#94A3B8",
  glow: "rgba(226,232,240,0.45)",
  sheenStops: [
    "rgba(255,255,255,0)",
    "rgba(255,255,255,0.22)",
    "rgba(255,255,255,0)",
  ],
  sheenAlpha: 0.22,
};

const TIERS: Record<string, TierStyle> = {
  common: DEFAULT_TIER,
  rare: {
    label: "Rare",
    stars: "★★",
    stops: ["#6D28D9", "#A855F7", "#F472B6", "#22D3EE", "#4C1D95"],
    accent: "#D8B4FE",
    accent2: "#22D3EE",
    glow: "rgba(168,85,247,0.75)",
    sheenStops: [
      "rgba(34,211,238,0)",
      "rgba(192,132,252,0.5)",
      "rgba(34,211,238,0.4)",
      "rgba(34,211,238,0)",
    ],
    sheenAlpha: 0.28,
  },
  super_rare: {
    label: "Super Rare",
    stars: "★★★",
    stops: ["#78350F", "#D97706", "#FDE047", "#FFFFFF", "#F59E0B", "#92400E"],
    accent: "#FDE047",
    accent2: "#F59E0B",
    glow: "rgba(245,158,11,0.85)",
    sheenStops: [
      "rgba(245,158,11,0)",
      "rgba(254,240,138,0.65)",
      "rgba(255,255,255,0.5)",
      "rgba(245,158,11,0)",
    ],
    sheenAlpha: 0.34,
  },
  ultra_rare: {
    label: "Ultra Rare",
    stars: "★★★★",
    stops: ["#BE123C", "#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#A855F7"],
    accent: "#F9A8D4",
    accent2: "#FDE047",
    glow: "rgba(244,63,94,0.9)",
    sheenStops: [
      "rgba(244,63,94,0)",
      "rgba(251,191,36,0.55)",
      "rgba(255,255,255,0.5)",
      "rgba(52,211,153,0.45)",
      "rgba(168,85,247,0)",
    ],
    sheenAlpha: 0.4,
  },
  holo: {
    label: "Holo",
    stars: "★★★★★",
    stops: [
      "#E0F2FE",
      "#F5D0FE",
      "#FEF08A",
      "#FFFFFF",
      "#BAE6FD",
      "#FBCFE8",
      "#DDD6FE",
    ],
    accent: "#FEF08A",
    accent2: "#BAE6FD",
    glow: "rgba(254,240,138,0.75)",
    sheenStops: [
      "rgba(186,230,253,0)",
      "rgba(254,240,138,0.22)",
      "rgba(255,255,255,0.28)",
      "rgba(251,207,232,0.22)",
      "rgba(186,230,253,0)",
    ],
    sheenAlpha: 0.14,
  },
  secret: {
    label: "Secret",
    stars: "★★★★★★",
    stops: [
      "#082F49",
      "#38BDF8",
      "#E0F2FE",
      "#FFFFFF",
      "#C4B5FD",
      "#22D3EE",
      "#0C4A6E",
    ],
    accent: "#A5F3FC",
    accent2: "#DDD6FE",
    glow: "rgba(56,189,248,0.85)",
    sheenStops: [
      "rgba(56,189,248,0)",
      "rgba(186,230,253,0.24)",
      "rgba(255,255,255,0.32)",
      "rgba(196,181,253,0.22)",
      "rgba(56,189,248,0)",
    ],
    sheenAlpha: 0.16,
  },
};

let fontsRegistered = false;

export function registerFonts(fontsDir: string): boolean {
  if (fontsRegistered) return true;
  try {
    const regular = GlobalFonts.registerFromPath(
      path.join(fontsDir, "Inter-Regular.otf"),
      "Inter",
    );
    const bold = GlobalFonts.registerFromPath(
      path.join(fontsDir, "Inter-Bold.otf"),
      "Inter Bold",
    );
    fontsRegistered = regular !== null && bold !== null;
    if (!fontsRegistered) {
      console.warn(
        "warning: Inter font registration failed, using sans-serif fallback",
      );
    }
    return fontsRegistered;
  } catch {
    console.warn(
      "warning: Inter font files missing, using sans-serif fallback",
    );
    return false;
  }
}

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function roundRectSubPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  roundRectSubPath(ctx, x, y, w, h, r);
}

function makeGradient(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: string[],
): CanvasGradient {
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((color, i) => {
    grad.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), color);
  });
  return grad;
}

function drawGradeMotif(
  ctx: Ctx,
  rarity: string,
  iw: number,
  ih: number,
  tier: TierStyle,
): void {
  if (rarity === "common") {
    const m = 16;
    const len = 26;
    ctx.save();
    ctx.strokeStyle = "rgba(226,232,240,0.6)";
    ctx.lineWidth = 1.5;
    for (const [cx, cy, sx, sy] of [
      [m, m, 1, 1],
      [iw - m, m, -1, 1],
      [m, ih - m, 1, -1],
      [iw - m, ih - m, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * len);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * len, cy);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (rarity === "rare") {
    ctx.save();
    ctx.shadowColor = tier.glow;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = makeGradient(ctx, 0, 120, 0, ih - 180, [
      "rgba(34,211,238,0)",
      tier.accent2,
      tier.accent,
      "rgba(168,85,247,0)",
    ]);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(14, 150);
    ctx.lineTo(14, ih - 210);
    ctx.moveTo(iw - 14, 150);
    ctx.lineTo(iw - 14, ih - 210);
    ctx.stroke();

    ctx.strokeStyle = tier.accent2;
    ctx.lineWidth = 2;
    for (const [cx, cy, sx, sy] of [
      [14, 14, 1, 1],
      [iw - 14, 14, -1, 1],
      [14, ih - 14, 1, -1],
      [iw - 14, ih - 14, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * 36);
      ctx.lineTo(cx, cy + sy * 12);
      ctx.lineTo(cx + sx * 12, cy);
      ctx.lineTo(cx + sx * 36, cy);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (rarity === "super_rare") {
    ctx.save();
    ctx.shadowColor = tier.glow;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = tier.accent;
    ctx.lineWidth = 1.8;
    roundRectPath(ctx, 12, 12, iw - 24, ih - 24, RADIUS - BORDER - 8);
    ctx.stroke();

    for (const [cx, cy, sx, sy] of [
      [12, 12, 1, 1],
      [iw - 12, 12, -1, 1],
      [12, ih - 12, 1, -1],
      [iw - 12, ih - 12, -1, -1],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.beginPath();
      ctx.moveTo(0, 48);
      ctx.lineTo(14, 48);
      ctx.lineTo(14, 14);
      ctx.lineTo(48, 14);
      ctx.lineTo(48, 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = "#FEF08A";
    ctx.beginPath();
    ctx.moveTo(iw / 2, 16);
    ctx.lineTo(iw / 2 + 12, 28);
    ctx.lineTo(iw / 2, 40);
    ctx.lineTo(iw / 2 - 12, 28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  if (rarity === "ultra_rare") {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const shards: Array<[number, number, number, number, number, number, string]> = [
      [0, 120, 110, 260, 0, 340, "rgba(244,63,94,0.22)"],
      [iw, 180, iw - 125, 310, iw, 420, "rgba(59,130,246,0.22)"],
      [0, 420, 95, 520, 0, 610, "rgba(251,191,36,0.18)"],
      [iw, 480, iw - 105, 580, iw, 670, "rgba(168,85,247,0.22)"],
    ];
    for (const [x1, y1, x2, y2, x3, y3, col] of shards) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = tier.glow;
    ctx.shadowBlur = 14;
    for (const [cx, cy, sx, sy] of [
      [10, 10, 1, 1],
      [iw - 10, 10, -1, 1],
      [10, ih - 10, 1, -1],
      [iw - 10, ih - 10, -1, -1],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = makeGradient(ctx, 0, 0, 56, 56, tier.stops);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 54);
      ctx.lineTo(0, 12);
      ctx.lineTo(12, 0);
      ctx.lineTo(54, 0);
      ctx.lineTo(38, 16);
      ctx.lineTo(16, 16);
      ctx.lineTo(16, 38);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  if (rarity === "holo") {
    // Clean, unobstructed portrait window with a delicate pearlescent inner hairline.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = makeGradient(ctx, 0, 0, iw, ih, tier.stops);
    ctx.lineWidth = 1.25;
    roundRectPath(ctx, 10, 10, iw - 20, ih - 20, RADIUS - BORDER - 6);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (rarity === "secret") {
    // Sleek crystal-cyan inner hairline & top diamond emblem without obscuring the photo.
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = makeGradient(ctx, 0, 0, iw, ih, tier.stops);
    ctx.lineWidth = 1.4;
    roundRectPath(ctx, 10, 10, iw - 20, ih - 20, RADIUS - BORDER - 6);
    ctx.stroke();

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#E0F2FE";
    ctx.beginPath();
    ctx.moveTo(iw / 2, 13);
    ctx.lineTo(iw / 2 + 10, 22);
    ctx.lineTo(iw / 2, 31);
    ctx.lineTo(iw / 2 - 10, 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

async function drawBaseCard(ctx: Ctx, input: CardInput): Promise<void> {
  const tier = TIERS[input.rarity] ?? DEFAULT_TIER;
  const animated = isAnimatedRarity(input.rarity);

  // 1. Sculpted outer metallic/iridescent frame.
  roundRectPath(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  ctx.fillStyle = makeGradient(ctx, 0, 0, CARD_W, CARD_H, tier.stops);
  ctx.fill();

  // Top-left bright bevel rim & bottom-right deep shadow bevel.
  ctx.save();
  roundRectPath(ctx, 1.5, 1.5, CARD_W - 3, CARD_H - 3, RADIUS - 1.5);
  ctx.lineWidth = 3;
  const bevel = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bevel.addColorStop(0, "rgba(255,255,255,0.92)");
  bevel.addColorStop(0.35, "rgba(255,255,255,0.28)");
  bevel.addColorStop(0.65, "rgba(0,0,0,0.22)");
  bevel.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.strokeStyle = bevel;
  ctx.stroke();
  ctx.restore();

  // Recessed frame channel (soft silver-slate for holo, deep obsidian for others).
  ctx.save();
  roundRectPath(
    ctx,
    BORDER - 3,
    BORDER - 3,
    CARD_W - (BORDER - 3) * 2,
    CARD_H - (BORDER - 3) * 2,
    RADIUS - BORDER + 3,
  );
  ctx.fillStyle =
    input.rarity === "holo"
      ? "rgba(226, 232, 240, 0.45)"
      : "rgba(8, 10, 18, 0.88)";
  ctx.fill();
  ctx.restore();

  const iw = CARD_W - BORDER * 2;
  const ih = CARD_H - BORDER * 2;
  ctx.save();
  ctx.translate(BORDER, BORDER);
  roundRectPath(ctx, 0, 0, iw, ih, RADIUS - BORDER);
  ctx.clip();

  // 2. Photo cover-crop 2:3 centered on focus point.
  const photo = await loadImage(input.rawPath);
  const scale = Math.max(iw / photo.width, ih / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  const fx = Math.min(1, Math.max(0, input.focusX));
  const fy = Math.min(1, Math.max(0, input.focusY));
  const dx = Math.min(0, Math.max(iw - dw, (iw - dw) * fx));
  const dy = Math.min(0, Math.max(ih - dh, (ih - dh) * fy));
  ctx.drawImage(photo, dx, dy, dw, dh);

  // 3. Recessed inner shadow around photo frame seam.
  ctx.save();
  ctx.shadowColor =
    input.rarity === "holo" ? "rgba(15,23,42,0.45)" : "rgba(0,0,0,0.92)";
  ctx.shadowBlur = input.rarity === "holo" ? 16 : 30;
  ctx.lineWidth = input.rarity === "holo" ? 10 : 14;
  ctx.strokeStyle =
    input.rarity === "holo" ? "rgba(15,23,42,0.35)" : "rgba(0,0,0,0.72)";
  roundRectPath(ctx, -6, -6, iw + 12, ih + 12, RADIUS - BORDER + 4);
  ctx.stroke();
  ctx.restore();

  // 4. Diagonal glossy light sweep (static cards only; animated cards render a moving foil glint per frame).
  if (!animated) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = tier.sheenAlpha;
    ctx.translate(iw * 0.5, ih * 0.36);
    ctx.rotate(-0.58);
    const beam = ctx.createLinearGradient(0, -240, 0, 240);
    tier.sheenStops.forEach((c, i) => {
      beam.addColorStop(
        tier.sheenStops.length === 1 ? 0.5 : i / (tier.sheenStops.length - 1),
        c,
      );
    });
    ctx.fillStyle = beam;
    ctx.fillRect(-iw * 1.2, -240, iw * 2.4, 480);
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const gloss = ctx.createRadialGradient(
    iw * 0.14,
    ih * 0.06,
    10,
    iw * 0.14,
    ih * 0.06,
    iw * 0.82,
  );
  gloss.addColorStop(0, animated ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.22)");
  gloss.addColorStop(0.5, animated ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, iw, ih * 0.65);
  ctx.restore();

  // 5. Deep cinematic bottom vignette (starts lower on animated cards to keep portrait bright).
  const gradTop = animated ? ih * 0.58 : ih * 0.5;
  const shade = ctx.createLinearGradient(0, gradTop, 0, ih);
  shade.addColorStop(0, "rgba(4,6,14,0)");
  shade.addColorStop(0.42, animated ? "rgba(4,6,14,0.42)" : "rgba(4,6,14,0.5)");
  shade.addColorStop(0.75, animated ? "rgba(4,6,14,0.82)" : "rgba(4,6,14,0.88)");
  shade.addColorStop(1, animated ? "rgba(4,6,14,0.94)" : "rgba(4,6,14,0.97)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, gradTop - 1, iw, ih - gradTop + 1);

  // 6. Grade-specific bespoke motif & framing.
  drawGradeMotif(ctx, input.rarity, iw, ih, tier);

  const pad = 34;
  const nameFont = fontsRegistered ? "Inter Bold" : "sans-serif";
  const bodyFont = fontsRegistered ? "Inter" : "sans-serif";

  // 7. Glassmorphic top pills with strong 3D shadow + glowing border.
  ctx.font = `700 22px ${nameFont}, sans-serif`;
  const badgeW = ctx.measureText(input.badge).width + 36;
  const starsW = ctx.measureText(tier.stars).width + 36;
  const pillY = 30;
  const pillH = 46;

  for (const [px, pw, text, textColor] of [
    [pad, badgeW, input.badge, "#FFFFFF"],
    [iw - pad - starsW, starsW, tier.stars, tier.accent],
  ] as const) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.88)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, px, pillY, pw, pillH, 23);
    ctx.fillStyle = "rgba(8, 10, 18, 0.84)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, px, pillY, pw, pillH, 23);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = makeGradient(ctx, px, pillY, px + pw, pillY + pillH, tier.stops);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = textColor;
    ctx.textBaseline = "middle";
    ctx.shadowColor = tier.glow;
    ctx.shadowBlur = 12;
    ctx.fillText(text, px + 18, pillY + pillH / 2 + 1);
    ctx.restore();
  }

  // 8. Luxury Nameplate & Typography with realistic multi-pass shadow.
  const title = input.photoLabel ?? input.memberName;
  const subtitle = input.photoLabel ?? input.fullName;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.95)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 54px ${nameFont}, sans-serif`;
  ctx.fillText(title, pad, ih - 126, iw - pad * 2);
  if (subtitle !== null && subtitle !== "") {
    ctx.font = `400 22px ${bodyFont}, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillText(
      input.photoLabel !== null ? input.memberName : subtitle,
      pad,
      ih - 92,
      iw - pad * 2,
    );
  }
  ctx.restore();

  // Glowing gradient accent divider.
  ctx.save();
  ctx.shadowColor = tier.glow;
  ctx.shadowBlur = 12;
  ctx.fillStyle = makeGradient(ctx, pad, ih - 74, iw - pad, ih - 74, tier.stops);
  ctx.fillRect(pad, ih - 74, iw - pad * 2, 3);
  ctx.restore();

  // Rarity label bottom-left.
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = tier.glow;
  ctx.shadowBlur = 10;
  ctx.font = `700 21px ${nameFont}, sans-serif`;
  ctx.fillStyle = tier.accent;
  ctx.fillText(
    `${tier.label} · Foto ${input.photoNo}/${input.photoTotal}`,
    pad,
    ih - 39,
    iw - pad * 2 - 150,
  );
  ctx.restore();

  // Metallic Serial Pill bottom-right.
  const serialText = `No. ${input.serial}`;
  ctx.font = `700 19px ${nameFont}, sans-serif`;
  const serialW = ctx.measureText(serialText).width + 24;
  const serialX = iw - pad - serialW;
  const serialY = ih - 62;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.82)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  roundRectPath(ctx, serialX, serialY, serialW, 32, 16);
  ctx.fillStyle = "rgba(10, 12, 22, 0.86)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = makeGradient(
    ctx,
    serialX,
    serialY,
    serialX + serialW,
    serialY + 32,
    tier.stops,
  );
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.fillText(serialText, serialX + 12, serialY + 17);
  ctx.restore();

  // Inner metallic bezel ring.
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = makeGradient(ctx, 0, 0, iw, ih, tier.stops);
  roundRectPath(ctx, 1, 1, iw - 2, ih - 2, RADIUS - BORDER);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

interface SparkleSpec {
  x: number;
  y: number;
  size: number;
  phase: number;
}

// Positioned along the perimeter & lower area so the central portrait face/subject stays 100% clear.
const HOLO_SPARKLES: readonly SparkleSpec[] = [
  { x: 52, y: 175, size: 9, phase: 0.0 },
  { x: 522, y: 215, size: 11, phase: 0.25 },
  { x: 34, y: 315, size: 7, phase: 0.52 },
  { x: 468, y: 310, size: 8, phase: 0.72 },
  { x: 78, y: 520, size: 7, phase: 0.16 },
  { x: 515, y: 510, size: 8, phase: 0.61 },
  { x: 148, y: 650, size: 7, phase: 0.38 },
  { x: 236, y: 690, size: 8, phase: 0.84 },
  { x: 396, y: 680, size: 7, phase: 0.44 },
  { x: 512, y: 645, size: 11, phase: 0.91 },
  { x: 82, y: 745, size: 8, phase: 0.12 },
  { x: 298, y: 795, size: 7, phase: 0.67 },
];

const SECRET_SPARKLES: readonly SparkleSpec[] = [
  { x: 48, y: 160, size: 10, phase: 0.05 },
  { x: 518, y: 185, size: 12, phase: 0.3 },
  { x: 42, y: 330, size: 8, phase: 0.55 },
  { x: 506, y: 340, size: 9, phase: 0.78 },
  { x: 66, y: 495, size: 8, phase: 0.18 },
  { x: 514, y: 490, size: 10, phase: 0.65 },
  { x: 130, y: 640, size: 8, phase: 0.42 },
  { x: 255, y: 685, size: 9, phase: 0.88 },
  { x: 410, y: 670, size: 8, phase: 0.48 },
  { x: 516, y: 635, size: 11, phase: 0.95 },
  { x: 92, y: 750, size: 9, phase: 0.12 },
  { x: 320, y: 790, size: 8, phase: 0.7 },
];

function drawFourPointStar(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  haloColor: string,
  alpha: number,
): void {
  if (alpha <= 0.04 || r <= 0.5) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = alpha;

  // Soft subtle halo behind the star.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.15);
  halo.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  halo.addColorStop(0.45, haloColor);
  halo.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.fill();

  // Crisp needle-sharp 4-point white star core.
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  const inner = r * 0.18;
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(inner, -inner, r, 0);
  ctx.quadraticCurveTo(inner, inner, 0, r);
  ctx.quadraticCurveTo(-inner, inner, -r, 0);
  ctx.quadraticCurveTo(-inner, -inner, 0, -r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAnimatedOuterBorder(
  ctx: Ctx,
  angle: number,
  stops: string[],
  isHolo: boolean,
): void {
  const iw = CARD_W - BORDER * 2;
  const ih = CARD_H - BORDER * 2;
  ctx.save();
  ctx.beginPath();
  roundRectSubPath(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  roundRectSubPath(ctx, BORDER, BORDER, iw, ih, RADIUS - BORDER);
  ctx.clip("evenodd");

  const bx = Math.cos(angle) * (CARD_W * 0.65);
  const by = Math.sin(angle) * (CARD_H * 0.65);
  ctx.fillStyle = makeGradient(
    ctx,
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
    stops,
  );
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Outer specular bevel highlight.
  roundRectPath(ctx, 1.5, 1.5, CARD_W - 3, CARD_H - 3, RADIUS - 1.5);
  ctx.lineWidth = 2.5;
  const bevel = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bevel.addColorStop(0, "rgba(255,255,255,0.95)");
  bevel.addColorStop(0.5, isHolo ? "rgba(255,255,255,0.45)" : "rgba(186,230,253,0.35)");
  bevel.addColorStop(1, isHolo ? "rgba(148,163,184,0.45)" : "rgba(8,47,73,0.65)");
  ctx.strokeStyle = bevel;
  ctx.stroke();
  ctx.restore();
}

function drawHoloFrameOverlay(ctx: Ctx, progress: number): void {
  const iw = CARD_W - BORDER * 2;
  const ih = CARD_H - BORDER * 2;
  const angle = progress * Math.PI * 2;

  // 1. Pearlescent animated outer border shimmer (leaves photo untouched).
  drawAnimatedOuterBorder(
    ctx,
    angle,
    [
      "#FFFFFF",
      "#E0F2FE",
      "#FCE7F3",
      "#FEF9C3",
      "#EDE9FE",
      "#CFFAFE",
      "#FFFFFF",
    ],
    true,
  );

  ctx.save();
  ctx.translate(BORDER, BORDER);
  roundRectPath(ctx, 0, 0, iw, ih, RADIUS - BORDER);
  ctx.clip();

  // 2. Whisper-thin diagonal pearlescent foil glint (low alpha preserves 100% portrait detail).
  const shift = (progress * 2.1 - 0.55) * CARD_W;
  const sheen = ctx.createLinearGradient(
    shift - 135,
    -60,
    shift + 175,
    CARD_H * 0.85,
  );
  sheen.addColorStop(0.0, "rgba(186, 230, 253, 0)");
  sheen.addColorStop(0.32, "rgba(186, 230, 253, 0.065)");
  sheen.addColorStop(0.48, "rgba(255, 255, 255, 0.10)");
  sheen.addColorStop(0.62, "rgba(251, 207, 232, 0.07)");
  sheen.addColorStop(0.78, "rgba(254, 240, 138, 0.055)");
  sheen.addColorStop(1.0, "rgba(196, 181, 253, 0)");
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, iw, ih);

  // 3. Delicate twinkling white 4-point stars along the margins.
  ctx.globalCompositeOperation = "source-over";
  for (const sp of HOLO_SPARKLES) {
    const pulse = 0.5 + 0.5 * Math.sin(angle + sp.phase * Math.PI * 2);
    const sharpPulse = Math.pow(pulse, 1.35);
    drawFourPointStar(
      ctx,
      sp.x,
      sp.y,
      sp.size * (0.45 + 0.6 * sharpPulse),
      "rgba(254, 249, 195, 0.42)",
      0.28 + 0.72 * sharpPulse,
    );
  }

  // 4. Refined pearlescent inner bezel stroke.
  const bx = Math.cos(angle) * (CARD_W * 0.5);
  const by = Math.sin(angle) * (CARD_H * 0.5);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = makeGradient(
    ctx,
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
    ["#FFFFFF", "#BAE6FD", "#FBCFE8", "#FEF08A", "#DDD6FE", "#FFFFFF"],
  );
  roundRectPath(ctx, 1, 1, iw - 2, ih - 2, RADIUS - BORDER);
  ctx.stroke();
  ctx.restore();
}

function drawSecretFrameOverlay(ctx: Ctx, progress: number): void {
  const iw = CARD_W - BORDER * 2;
  const ih = CARD_H - BORDER * 2;
  const angle = progress * Math.PI * 2;

  // 1. Prismatic ice-diamond animated outer border.
  drawAnimatedOuterBorder(
    ctx,
    angle,
    [
      "#0C4A6E",
      "#38BDF8",
      "#E0F2FE",
      "#FFFFFF",
      "#C4B5FD",
      "#22D3EE",
      "#0C4A6E",
    ],
    false,
  );

  ctx.save();
  ctx.translate(BORDER, BORDER);
  roundRectPath(ctx, 0, 0, iw, ih, RADIUS - BORDER);
  ctx.clip();

  // 2. Crisp, narrow diamond-cyan specular glint (keeps portrait crystal clear).
  ctx.globalCompositeOperation = "screen";
  const shift1 = (progress * 2.15 - 0.58) * CARD_W;
  const beam1 = ctx.createLinearGradient(
    shift1 - 125,
    -40,
    shift1 + 165,
    CARD_H * 0.85,
  );
  beam1.addColorStop(0.0, "rgba(34, 211, 238, 0)");
  beam1.addColorStop(0.35, "rgba(103, 232, 249, 0.08)");
  beam1.addColorStop(0.5, "rgba(255, 255, 255, 0.12)");
  beam1.addColorStop(0.65, "rgba(196, 181, 253, 0.075)");
  beam1.addColorStop(1.0, "rgba(14, 165, 233, 0)");
  ctx.fillStyle = beam1;
  ctx.fillRect(0, 0, iw, ih);

  // 3. Edge-only subtle cyan rim aura (zero opacity across the central 84% of the portrait).
  const auraAlpha = 0.07 + 0.05 * Math.sin(angle);
  const aura = ctx.createRadialGradient(
    iw * 0.5,
    ih * 0.45,
    iw * 0.44,
    iw * 0.5,
    ih * 0.45,
    ih * 0.66,
  );
  aura.addColorStop(0, "rgba(34, 211, 238, 0)");
  aura.addColorStop(1, `rgba(103, 232, 249, ${auraAlpha.toFixed(3)})`);
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, iw, ih);

  // 4. Delicate diamond sparkles along the margins.
  ctx.globalCompositeOperation = "source-over";
  for (const sp of SECRET_SPARKLES) {
    const pulse = 0.5 + 0.5 * Math.sin(angle + sp.phase * Math.PI * 2);
    const sharpPulse = Math.pow(pulse, 1.35);
    const driftY = ((progress + sp.phase) % 1) * -14;
    drawFourPointStar(
      ctx,
      sp.x,
      sp.y + driftY,
      sp.size * (0.45 + 0.6 * sharpPulse),
      "rgba(165, 243, 252, 0.45)",
      0.3 + 0.7 * sharpPulse,
    );
  }

  // 5. Animated crystal-cyan inner bezel stroke.
  const bx = Math.cos(angle) * (CARD_W * 0.5);
  const by = Math.sin(angle) * (CARD_H * 0.5);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = makeGradient(
    ctx,
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
    ["#22D3EE", "#FFFFFF", "#7DD3FC", "#C4B5FD", "#22D3EE"],
  );
  roundRectPath(ctx, 1, 1, iw - 2, ih - 2, RADIUS - BORDER);
  ctx.stroke();
  ctx.restore();
}

/**
 * Builds a unified 255-color rgb565 master palette sampled from the clean base
 * portrait and all animated frames so static portrait pixels never flicker or
 * posterize between frames, reserving 1 index for transparent rounded corners.
 */
function buildMasterGifPalette(
  baseData: Uint8ClampedArray,
  frames: Uint8ClampedArray[],
): { opaquePalette: number[][]; fullPalette: number[][]; transparentIndex: number } {
  const pixelCount = baseData.length >>> 2;
  const baseStride = 3;
  const frameStride = 11;
  let samplePixels = 0;

  for (let p = 0; p < pixelCount; p += baseStride) {
    if ((baseData[p * 4 + 3] ?? 0) >= 128) samplePixels += 1;
  }
  for (const frame of frames) {
    for (let p = 0; p < pixelCount; p += frameStride) {
      if ((frame[p * 4 + 3] ?? 0) >= 128) samplePixels += 1;
    }
  }

  const sampleRgba = new Uint8Array(Math.max(1, samplePixels) * 4);
  let writeOffset = 0;

  for (let p = 0; p < pixelCount; p += baseStride) {
    const off = p * 4;
    if ((baseData[off + 3] ?? 0) < 128) continue;
    sampleRgba[writeOffset] = baseData[off] ?? 0;
    sampleRgba[writeOffset + 1] = baseData[off + 1] ?? 0;
    sampleRgba[writeOffset + 2] = baseData[off + 2] ?? 0;
    sampleRgba[writeOffset + 3] = 255;
    writeOffset += 4;
  }

  for (const frame of frames) {
    for (let p = 0; p < pixelCount; p += frameStride) {
      const off = p * 4;
      if ((frame[off + 3] ?? 0) < 128) continue;
      sampleRgba[writeOffset] = frame[off] ?? 0;
      sampleRgba[writeOffset + 1] = frame[off + 1] ?? 0;
      sampleRgba[writeOffset + 2] = frame[off + 2] ?? 0;
      sampleRgba[writeOffset + 3] = 255;
      writeOffset += 4;
    }
  }

  const opaquePalette = quantize(sampleRgba, 255, { format: "rgb565" });
  const transparentIndex = opaquePalette.length;
  const fullPalette = [...opaquePalette, [0, 0, 0]];
  return { opaquePalette, fullPalette, transparentIndex };
}

async function buildAnimatedCardGif(input: CardInput): Promise<Buffer> {
  const baseCanvas = createCanvas(ANIM_W, ANIM_H);
  const baseCtx = baseCanvas.getContext("2d");
  baseCtx.scale(ANIM_W / CARD_W, ANIM_H / CARD_H);
  await drawBaseCard(baseCtx, input);
  const baseData = baseCtx.getImageData(0, 0, ANIM_W, ANIM_H).data;

  const frameCanvas = createCanvas(ANIM_W, ANIM_H);
  const frameCtx = frameCanvas.getContext("2d");

  const isSecret = input.rarity === "secret";
  const frames: Uint8ClampedArray[] = [];

  for (let i = 0; i < ANIM_FRAMES; i += 1) {
    const progress = i / ANIM_FRAMES;
    frameCtx.clearRect(0, 0, ANIM_W, ANIM_H);
    frameCtx.drawImage(baseCanvas, 0, 0);

    frameCtx.save();
    frameCtx.scale(ANIM_W / CARD_W, ANIM_H / CARD_H);
    if (isSecret) {
      drawSecretFrameOverlay(frameCtx, progress);
    } else {
      drawHoloFrameOverlay(frameCtx, progress);
    }
    frameCtx.restore();

    frames.push(frameCtx.getImageData(0, 0, ANIM_W, ANIM_H).data);
  }

  const { opaquePalette, fullPalette, transparentIndex } = buildMasterGifPalette(
    baseData,
    frames,
  );

  const gif = GIFEncoder();
  const pixelCount = ANIM_W * ANIM_H;

  for (let i = 0; i < frames.length; i += 1) {
    const rgba = frames[i];
    if (rgba === undefined) continue;
    const indexed = applyPalette(rgba, opaquePalette, "rgb565");
    for (let p = 0; p < pixelCount; p += 1) {
      if ((rgba[p * 4 + 3] ?? 0) < 128) {
        indexed[p] = transparentIndex;
      }
    }
    gif.writeFrame(indexed, ANIM_W, ANIM_H, {
      palette: i === 0 ? fullPalette : null,
      delay: ANIM_DELAY_MS,
      repeat: 0,
      transparent: true,
      transparentIndex,
      dispose: 2,
    });
  }

  gif.finish();
  return Buffer.from(gif.bytesView());
}

export async function buildCardImage(input: CardInput): Promise<Buffer> {
  if (isAnimatedRarity(input.rarity)) {
    return buildAnimatedCardGif(input);
  }
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  await drawBaseCard(ctx, input);
  const webp = await canvas.encode("webp", 85);
  return Buffer.from(webp);
}

export interface BuiltCard {
  cardId: string;
  fileName: string;
}

export async function buildAllCards(
  inputs: CardInput[],
  outDir: string,
): Promise<BuiltCard[]> {
  await mkdir(outDir, { recursive: true });
  const built: BuiltCard[] = [];
  const live = new Set<string>();
  for (const input of inputs) {
    const buffer = await buildCardImage(input);
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
    const ext = cardFileExtension(input.rarity);
    const fileName = `${input.cardId}.${hash}.${ext}`;
    live.add(fileName);
    await writeFile(path.join(outDir, fileName), buffer);
    built.push({ cardId: input.cardId, fileName });
  }
  // Prune stale files for cards no longer enabled/present.
  let existing: string[];
  try {
    existing = await readdir(outDir);
  } catch {
    existing = [];
  }
  for (const file of existing) {
    if ((file.endsWith(".webp") || file.endsWith(".gif")) && !live.has(file)) {
      await rm(path.join(outDir, file));
    }
  }
  return built;
}
