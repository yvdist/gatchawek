import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import * as gifenc from "gifenc";
const { applyPalette, GIFEncoder, quantize } = gifenc;

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
    stops: ["#06B6D4", "#8B5CF6", "#EC4899", "#FACC15", "#10B981", "#38BDF8", "#FFFFFF"],
    accent: "#FDE047",
    accent2: "#38BDF8",
    glow: "rgba(250,204,21,0.95)",
    sheenStops: [
      "rgba(56,189,248,0)",
      "rgba(253,224,71,0.7)",
      "rgba(255,255,255,0.75)",
      "rgba(236,72,153,0.6)",
      "rgba(52,211,153,0.6)",
      "rgba(168,85,247,0)",
    ],
    sheenAlpha: 0.48,
  },
  secret: {
    label: "Secret",
    stars: "★★★★★★",
    stops: ["#082F49", "#0EA5E9", "#67E8F9", "#FFFFFF", "#A78BFA", "#22D3EE", "#0F172A"],
    accent: "#A5F3FC",
    accent2: "#C4B5FD",
    glow: "rgba(34,211,238,1)",
    sheenStops: [
      "rgba(14,165,233,0)",
      "rgba(165,243,252,0.8)",
      "rgba(255,255,255,0.85)",
      "rgba(196,181,253,0.7)",
      "rgba(34,211,238,0)",
    ],
    sheenAlpha: 0.54,
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

function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
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

function drawAnamorphicFlare(
  ctx: Ctx,
  cx: number,
  cy: number,
  width: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = alpha;

  const hg = ctx.createLinearGradient(-width, 0, width, 0);
  hg.addColorStop(0, "rgba(255,255,255,0)");
  hg.addColorStop(0.35, color);
  hg.addColorStop(0.5, "#FFFFFF");
  hg.addColorStop(0.65, color);
  hg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(0, 0, width, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const vg = ctx.createLinearGradient(0, -width * 0.28, 0, width * 0.28);
  vg.addColorStop(0, "rgba(255,255,255,0)");
  vg.addColorStop(0.5, "#FFFFFF");
  vg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = vg;
  ctx.beginPath();
  ctx.ellipse(0, 0, 2, width * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 16; i += 1) {
      const yBase = 80 + i * 38;
      ctx.strokeStyle = makeGradient(ctx, 0, yBase, iw, yBase + 60, [
        "rgba(56,189,248,0)",
        "rgba(253,224,71,0.22)",
        "rgba(236,72,153,0.22)",
        "rgba(52,211,153,0.22)",
        "rgba(56,189,248,0)",
      ]);
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      ctx.bezierCurveTo(
        iw * 0.33,
        yBase - 34,
        iw * 0.66,
        yBase + 34,
        iw,
        yBase - 12,
      );
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = tier.glow;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = makeGradient(ctx, 0, 0, iw, ih, tier.stops);
    ctx.lineWidth = 2.2;
    roundRectPath(ctx, 10, 10, iw - 20, ih - 20, RADIUS - BORDER - 6);
    ctx.stroke();

    for (const [cx, cy, sx, sy] of [
      [10, 10, 1, 1],
      [iw - 10, 10, -1, 1],
      [10, ih - 10, 1, -1],
      [iw - 10, ih - 10, -1, -1],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.fillStyle = makeGradient(ctx, 0, 0, 60, 60, tier.stops);
      ctx.beginPath();
      ctx.moveTo(0, 64);
      ctx.lineTo(0, 0);
      ctx.lineTo(64, 0);
      ctx.lineTo(48, 12);
      ctx.lineTo(18, 12);
      ctx.lineTo(12, 18);
      ctx.lineTo(12, 48);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    drawAnamorphicFlare(ctx, iw - 86, 53, 180, "#FDE047", 0.85);
    return;
  }

  if (rarity === "secret") {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 3; i += 1) {
      const y0 = 150 + i * 140;
      const g = ctx.createLinearGradient(0, y0 - 80, iw, y0 + 80);
      g.addColorStop(0, "rgba(34,211,238,0)");
      g.addColorStop(0.35, "rgba(103,232,249,0.22)");
      g.addColorStop(0.65, "rgba(167,139,250,0.22)");
      g.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(iw * 0.3, y0 - 90, iw * 0.7, y0 + 90, iw, y0 - 20);
      ctx.lineTo(iw, y0 + 55);
      ctx.bezierCurveTo(iw * 0.7, y0 + 145, iw * 0.3, y0 - 35, 0, y0 + 55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = "rgba(165,243,252,0.32)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(iw / 2, ih * 0.36, 210, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(196,181,253,0.26)";
    ctx.beginPath();
    ctx.arc(iw / 2, ih * 0.36, 232, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(iw / 2, ih * 0.36, 232, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = tier.glow;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = makeGradient(ctx, 0, 0, iw, ih, tier.stops);
    ctx.lineWidth = 2.4;
    roundRectPath(ctx, 10, 10, iw - 20, ih - 20, RADIUS - BORDER - 6);
    ctx.stroke();

    ctx.fillStyle = "#E0F2FE";
    ctx.beginPath();
    ctx.moveTo(iw / 2, 12);
    ctx.lineTo(iw / 2 + 16, 26);
    ctx.lineTo(iw / 2, 40);
    ctx.lineTo(iw / 2 - 16, 26);
    ctx.closePath();
    ctx.fill();

    for (const [cx, cy, sx, sy] of [
      [10, 10, 1, 1],
      [iw - 10, 10, -1, 1],
      [10, ih - 10, 1, -1],
      [iw - 10, ih - 10, -1, -1],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.fillStyle = makeGradient(ctx, 0, 0, 68, 68, tier.stops);
      ctx.beginPath();
      ctx.moveTo(0, 72);
      ctx.lineTo(0, 0);
      ctx.lineTo(72, 0);
      ctx.lineTo(52, 14);
      ctx.lineTo(22, 14);
      ctx.lineTo(14, 22);
      ctx.lineTo(14, 52);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    drawAnamorphicFlare(ctx, iw - 92, 53, 210, "#67E8F9", 0.95);
    drawAnamorphicFlare(ctx, 78, 53, 120, "#C4B5FD", 0.65);
  }
}

async function drawBaseCard(ctx: Ctx, input: CardInput): Promise<void> {
  const tier = TIERS[input.rarity] ?? DEFAULT_TIER;

  // 1. Sculpted outer metallic/iridescent frame.
  roundRectPath(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  ctx.fillStyle = makeGradient(ctx, 0, 0, CARD_W, CARD_H, tier.stops);
  ctx.fill();

  // Top-left bright bevel rim & bottom-right deep shadow bevel.
  ctx.save();
  roundRectPath(ctx, 1.5, 1.5, CARD_W - 3, CARD_H - 3, RADIUS - 1.5);
  ctx.lineWidth = 3;
  const bevel = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bevel.addColorStop(0, "rgba(255,255,255,0.9)");
  bevel.addColorStop(0.35, "rgba(255,255,255,0.22)");
  bevel.addColorStop(0.65, "rgba(0,0,0,0.28)");
  bevel.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.strokeStyle = bevel;
  ctx.stroke();
  ctx.restore();

  // Dark recessed frame channel.
  ctx.save();
  roundRectPath(
    ctx,
    BORDER - 3,
    BORDER - 3,
    CARD_W - (BORDER - 3) * 2,
    CARD_H - (BORDER - 3) * 2,
    RADIUS - BORDER + 3,
  );
  ctx.fillStyle = "rgba(8, 10, 18, 0.88)";
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
  ctx.shadowColor = "rgba(0,0,0,0.92)";
  ctx.shadowBlur = 30;
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  roundRectPath(ctx, -6, -6, iw + 12, ih + 12, RADIUS - BORDER + 4);
  ctx.stroke();
  ctx.restore();

  // 4. Diagonal glossy light sweep & studio corner reflection.
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
  gloss.addColorStop(0, "rgba(255,255,255,0.22)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0.05)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, iw, ih * 0.65);
  ctx.restore();

  // 5. Deep cinematic bottom vignette.
  const gradTop = ih * 0.5;
  const shade = ctx.createLinearGradient(0, gradTop, 0, ih);
  shade.addColorStop(0, "rgba(4,6,14,0)");
  shade.addColorStop(0.42, "rgba(4,6,14,0.5)");
  shade.addColorStop(0.75, "rgba(4,6,14,0.88)");
  shade.addColorStop(1, "rgba(4,6,14,0.97)");
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

const HOLO_SPARKLES: readonly SparkleSpec[] = [
  { x: 96, y: 150, size: 14, phase: 0.0 },
  { x: 492, y: 190, size: 16, phase: 0.25 },
  { x: 168, y: 310, size: 11, phase: 0.5 },
  { x: 430, y: 375, size: 15, phase: 0.72 },
  { x: 120, y: 500, size: 13, phase: 0.15 },
  { x: 510, y: 540, size: 12, phase: 0.6 },
  { x: 280, y: 210, size: 10, phase: 0.38 },
  { x: 340, y: 630, size: 14, phase: 0.85 },
  { x: 90, y: 690, size: 11, phase: 0.44 },
  { x: 470, y: 710, size: 12, phase: 0.92 },
];

const SECRET_SPARKLES: readonly SparkleSpec[] = [
  { x: 88, y: 140, size: 17, phase: 0.05 },
  { x: 504, y: 165, size: 18, phase: 0.3 },
  { x: 220, y: 245, size: 13, phase: 0.55 },
  { x: 405, y: 295, size: 16, phase: 0.78 },
  { x: 135, y: 405, size: 15, phase: 0.18 },
  { x: 485, y: 455, size: 17, phase: 0.65 },
  { x: 300, y: 145, size: 14, phase: 0.42 },
  { x: 270, y: 550, size: 16, phase: 0.88 },
  { x: 105, y: 645, size: 14, phase: 0.48 },
  { x: 495, y: 675, size: 15, phase: 0.95 },
  { x: 365, y: 485, size: 12, phase: 0.12 },
  { x: 195, y: 715, size: 13, phase: 0.7 },
];

function drawFourPointStar(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0.02 || r <= 0.5) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const inner = r * 0.24;
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.quadraticCurveTo(0, 0, 0, r);
  ctx.quadraticCurveTo(0, 0, -r, 0);
  ctx.quadraticCurveTo(0, 0, 0, -r);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.restore();
}

function drawHoloFrameOverlay(ctx: Ctx, progress: number): void {
  const iw = CARD_W - BORDER * 2;
  const ih = CARD_H - BORDER * 2;
  const angle = progress * Math.PI * 2;

  ctx.save();
  ctx.translate(BORDER, BORDER);
  roundRectPath(ctx, 0, 0, iw, ih, RADIUS - BORDER);
  ctx.clip();

  // Diagonal sweeping rainbow holographic sheen.
  const shift = (progress * 2.4 - 0.7) * CARD_W;
  const sheen = ctx.createLinearGradient(
    shift - 220,
    -100,
    shift + 340,
    CARD_H + 100,
  );
  sheen.addColorStop(0.0, "rgba(56, 189, 248, 0)");
  sheen.addColorStop(0.28, "rgba(56, 189, 248, 0.22)");
  sheen.addColorStop(0.45, "rgba(168, 85, 247, 0.30)");
  sheen.addColorStop(0.55, "rgba(255, 255, 255, 0.34)");
  sheen.addColorStop(0.68, "rgba(236, 72, 153, 0.28)");
  sheen.addColorStop(0.84, "rgba(250, 204, 21, 0.24)");
  sheen.addColorStop(1.0, "rgba(16, 185, 129, 0)");
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, iw, ih);

  // Twinkling gold/white sparkles.
  for (const sp of HOLO_SPARKLES) {
    const pulse = 0.5 + 0.5 * Math.sin(angle + sp.phase * Math.PI * 2);
    drawFourPointStar(
      ctx,
      sp.x,
      sp.y,
      sp.size * (0.45 + 0.65 * pulse),
      "#FEF08A",
      0.2 + 0.8 * pulse,
    );
  }

  // Shimmering rainbow border stroke.
  ctx.globalCompositeOperation = "source-over";
  const bx = Math.cos(angle) * (CARD_W * 0.5);
  const by = Math.sin(angle) * (CARD_H * 0.5);
  ctx.lineWidth = 4;
  ctx.strokeStyle = makeGradient(
    ctx,
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
    ["#38BDF8", "#A855F7", "#EC4899", "#FACC15", "#10B981"],
  );
  roundRectPath(ctx, 1, 1, iw - 2, ih - 2, RADIUS - BORDER);
  ctx.stroke();
  ctx.restore();
}

function drawSecretFrameOverlay(ctx: Ctx, progress: number): void {
  const iw = CARD_W - BORDER * 2;
  const ih = CARD_H - BORDER * 2;
  const angle = progress * Math.PI * 2;

  ctx.save();
  ctx.translate(BORDER, BORDER);
  roundRectPath(ctx, 0, 0, iw, ih, RADIUS - BORDER);
  ctx.clip();

  // Dual prismatic cyan-ice sweep.
  ctx.globalCompositeOperation = "screen";
  const shift1 = (progress * 2.5 - 0.75) * CARD_W;
  const beam1 = ctx.createLinearGradient(
    shift1 - 180,
    0,
    shift1 + 260,
    CARD_H,
  );
  beam1.addColorStop(0.0, "rgba(34, 211, 238, 0)");
  beam1.addColorStop(0.35, "rgba(34, 211, 238, 0.28)");
  beam1.addColorStop(0.5, "rgba(255, 255, 255, 0.45)");
  beam1.addColorStop(0.65, "rgba(165, 243, 252, 0.30)");
  beam1.addColorStop(1.0, "rgba(14, 165, 233, 0)");
  ctx.fillStyle = beam1;
  ctx.fillRect(0, 0, iw, ih);

  // Subtle pulsing cyan aura along the edge.
  const auraAlpha = 0.14 + 0.12 * Math.sin(angle);
  const aura = ctx.createRadialGradient(
    iw * 0.5,
    ih * 0.45,
    iw * 0.2,
    iw * 0.5,
    ih * 0.45,
    ih * 0.65,
  );
  aura.addColorStop(0, "rgba(34, 211, 238, 0)");
  aura.addColorStop(1, `rgba(34, 211, 238, ${auraAlpha.toFixed(3)})`);
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, iw, ih);

  // Prismatic diamond sparkles + rising motes.
  for (const sp of SECRET_SPARKLES) {
    const pulse = 0.5 + 0.5 * Math.sin(angle + sp.phase * Math.PI * 2);
    const driftY = ((progress + sp.phase) % 1) * -28;
    drawFourPointStar(
      ctx,
      sp.x,
      sp.y + driftY,
      sp.size * (0.4 + 0.7 * pulse),
      "#A5F3FC",
      0.25 + 0.75 * pulse,
    );
  }

  // Animated electric cyan/ice/indigo border.
  ctx.globalCompositeOperation = "source-over";
  const bx = Math.cos(angle) * (CARD_W * 0.5);
  const by = Math.sin(angle) * (CARD_H * 0.5);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = makeGradient(
    ctx,
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
    ["#22D3EE", "#FFFFFF", "#38BDF8", "#818CF8", "#22D3EE"],
  );
  roundRectPath(ctx, 1, 1, iw - 2, ih - 2, RADIUS - BORDER);
  ctx.stroke();
  ctx.restore();
}

async function buildAnimatedCardGif(input: CardInput): Promise<Buffer> {
  const baseCanvas = createCanvas(ANIM_W, ANIM_H);
  const baseCtx = baseCanvas.getContext("2d");
  baseCtx.scale(ANIM_W / CARD_W, ANIM_H / CARD_H);
  await drawBaseCard(baseCtx, input);

  const frameCanvas = createCanvas(ANIM_W, ANIM_H);
  const frameCtx = frameCanvas.getContext("2d");

  const gif = GIFEncoder();
  const isSecret = input.rarity === "secret";

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

    const imageData = frameCtx.getImageData(0, 0, ANIM_W, ANIM_H);
    const palette = quantize(imageData.data, 256, {
      format: "rgba4444",
      oneBitAlpha: true,
    });
    const indexed = applyPalette(imageData.data, palette, "rgba4444");
    gif.writeFrame(indexed, ANIM_W, ANIM_H, {
      palette,
      delay: ANIM_DELAY_MS,
      repeat: 0,
      transparent: true,
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
