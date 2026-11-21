import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { applyPalette, GIFEncoder, quantize } from "gifenc";

export const CARD_W = 600;
export const CARD_H = 900;
export const ANIM_W = 400;
export const ANIM_H = 600;
const ANIM_FRAMES = 12;
const ANIM_DELAY_MS = 75;
const RADIUS = 36;
const BORDER = 8;

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

export function isAnimatedRarity(rarity: string): boolean {
  return rarity === "holo" || rarity === "secret";
}

export function cardFileExtension(rarity: string): "gif" | "webp" {
  return isAnimatedRarity(rarity) ? "gif" : "webp";
}

const RARITY_STOPS: Record<string, string[]> = {
  common: ["#9CA3AF", "#E5E7EB"],
  rare: ["#F472B6", "#A855F7", "#22D3EE"],
  super_rare: ["#F59E0B", "#FDE68A"],
  ultra_rare: ["#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#A855F7"],
  holo: ["#38BDF8", "#A855F7", "#EC4899", "#F59E0B", "#10B981"],
  secret: ["#22D3EE", "#A5F3FC", "#0EA5E9"],
};

const RARITY_COLOR: Record<string, string> = {
  common: "#9CA3AF",
  rare: "#A855F7",
  super_rare: "#F59E0B",
  ultra_rare: "#EC4899",
  holo: "#FFD700",
  secret: "#22D3EE",
};

const RARITY_LABEL: Record<string, string> = {
  common: "Common",
  rare: "Rare",
  super_rare: "Super Rare",
  ultra_rare: "Ultra Rare",
  holo: "Holo",
  secret: "Secret",
};

const RARITY_STARS: Record<string, string> = {
  common: "★",
  rare: "★★",
  super_rare: "★★★",
  ultra_rare: "★★★★",
  holo: "★★★★★",
  secret: "★★★★★★",
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

function roundRectPath(ctx: Ctx, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.arcTo(w, 0, w, r, r);
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
}

function gradientFor(
  ctx: Ctx,
  stops: string[],
  x0 = 0,
  y0 = 0,
  x1 = CARD_W,
  y1 = CARD_H,
): CanvasGradient {
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((color, i) => {
    grad.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), color);
  });
  return grad;
}

async function drawBaseCard(ctx: Ctx, input: CardInput): Promise<void> {
  // Border: rounded-rect gradient slab, inner photo clipped inside.
  const stops =
    RARITY_STOPS[input.rarity] ?? RARITY_STOPS["common"] ?? ["#9CA3AF"];
  ctx.fillStyle = gradientFor(ctx, stops);
  roundRectPath(ctx, CARD_W, CARD_H, RADIUS);
  ctx.fill();

  const inner = BORDER;
  const iw = CARD_W - inner * 2;
  const ih = CARD_H - inner * 2;
  ctx.save();
  ctx.translate(inner, inner);
  roundRectPath(ctx, iw, ih, RADIUS - BORDER);
  ctx.clip();

  // Photo cover-crop 2:3 centered on focus point.
  const photo = await loadImage(input.rawPath);
  const scale = Math.max(iw / photo.width, ih / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  const fx = Math.min(1, Math.max(0, input.focusX));
  const fy = Math.min(1, Math.max(0, input.focusY));
  const dx = Math.min(0, Math.max(iw - dw, (iw - dw) * fx));
  const dy = Math.min(0, Math.max(ih - dh, (ih - dh) * fy));
  ctx.drawImage(photo, dx, dy, dw, dh);

  // Bottom 35% black gradient.
  const gradTop = ih * 0.65;
  const shade = ctx.createLinearGradient(0, gradTop, 0, ih);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, gradTop - 1, iw, ih - gradTop + 1);

  const pad = 36;
  const nameFont = fontsRegistered ? "Inter Bold" : "sans-serif";
  const bodyFont = fontsRegistered ? "Inter" : "sans-serif";

  // Pills.
  ctx.font = `700 24px ${nameFont}, sans-serif`;
  const badgeW = ctx.measureText(input.badge).width + 36;
  const stars = RARITY_STARS[input.rarity] ?? "★";
  const starsW = ctx.measureText(stars).width + 36;
  const pillY = 28;
  const pillH = 48;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(pad, pillY, badgeW, pillH, 24);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(iw - pad - starsW, pillY, starsW, pillH, 24);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.fillText(input.badge, pad + 18, pillY + pillH / 2 + 1);
  ctx.fillText(stars, iw - pad - starsW + 18, pillY + pillH / 2 + 1);

  // Text block.
  const labelColor = RARITY_COLOR[input.rarity] ?? "#9CA3AF";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 56px ${nameFont}, sans-serif`;
  const title = input.photoLabel ?? input.memberName;
  const subtitle = input.photoLabel ?? input.fullName;
  ctx.fillText(title, pad, ih - 118, iw - pad * 2);
  if (subtitle !== null && subtitle !== "") {
    ctx.font = `400 22px ${bodyFont}, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(
      input.photoLabel !== null ? input.memberName : subtitle,
      pad,
      ih - 86,
      iw - pad * 2,
    );
  }
  ctx.font = `700 20px ${nameFont}, sans-serif`;
  ctx.fillStyle = labelColor;
  const label = `${RARITY_LABEL[input.rarity] ?? input.rarity} · Foto ${input.photoNo}/${input.photoTotal}`;
  ctx.fillText(label, pad, ih - 52, iw - pad * 2 - 160);

  // Serial bottom-right.
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `700 20px ${nameFont}, sans-serif`;
  const serialText = `No. ${input.serial}`;
  const serialW = ctx.measureText(serialText).width;
  ctx.fillText(serialText, iw - pad - serialW, ih - 52);

  // Concentric ring over the clip seam.
  ctx.lineWidth = BORDER;
  ctx.strokeStyle = gradientFor(ctx, stops);
  roundRectPath(ctx, iw, ih, RADIUS - BORDER);
  ctx.stroke();

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
  const inner = BORDER;
  const iw = CARD_W - inner * 2;
  const ih = CARD_H - inner * 2;
  const angle = progress * Math.PI * 2;

  ctx.save();
  ctx.translate(inner, inner);
  roundRectPath(ctx, iw, ih, RADIUS - BORDER);
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
  ctx.lineWidth = BORDER * 1.4;
  ctx.strokeStyle = gradientFor(
    ctx,
    ["#38BDF8", "#A855F7", "#EC4899", "#FACC15", "#10B981"],
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
  );
  roundRectPath(ctx, iw, ih, RADIUS - BORDER);
  ctx.stroke();
  ctx.restore();
}

function drawSecretFrameOverlay(ctx: Ctx, progress: number): void {
  const inner = BORDER;
  const iw = CARD_W - inner * 2;
  const ih = CARD_H - inner * 2;
  const angle = progress * Math.PI * 2;

  ctx.save();
  ctx.translate(inner, inner);
  roundRectPath(ctx, iw, ih, RADIUS - BORDER);
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
  ctx.lineWidth = BORDER * 1.6;
  ctx.strokeStyle = gradientFor(
    ctx,
    ["#22D3EE", "#FFFFFF", "#38BDF8", "#818CF8", "#22D3EE"],
    CARD_W * 0.5 - bx,
    CARD_H * 0.5 - by,
    CARD_W * 0.5 + bx,
    CARD_H * 0.5 + by,
  );
  roundRectPath(ctx, iw, ih, RADIUS - BORDER);
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
