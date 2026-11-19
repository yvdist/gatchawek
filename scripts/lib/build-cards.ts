import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

export const CARD_W = 600;
export const CARD_H = 900;
const RADIUS = 36;
const BORDER = 8;

export interface CardInput {
  cardId: string;
  badge: string;
  memberName: string;
  fullName: string | null;
  rarity: string;
  serial: number;
  photoNo: number;
  photoTotal: number;
  rawPath: string;
  focusX: number;
  focusY: number;
}

const RARITY_STOPS: Record<string, string[]> = {
  common: ["#9CA3AF", "#E5E7EB"],
  rare: ["#F472B6", "#A855F7", "#22D3EE"],
  super_rare: ["#F59E0B", "#FDE68A"],
  ultra_rare: ["#F43F5E", "#F59E0B", "#10B981", "#3B82F6", "#A855F7"],
};

const RARITY_COLOR: Record<string, string> = {
  common: "#9CA3AF",
  rare: "#A855F7",
  super_rare: "#F59E0B",
  ultra_rare: "#EC4899",
};

const RARITY_LABEL: Record<string, string> = {
  common: "Common",
  rare: "Rare",
  super_rare: "Super Rare",
  ultra_rare: "Ultra Rare",
};

const RARITY_STARS: Record<string, string> = {
  common: "★",
  rare: "★★",
  super_rare: "★★★",
  ultra_rare: "★★★★",
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

function gradientFor(ctx: Ctx, stops: string[]): CanvasGradient {
  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  stops.forEach((color, i) => {
    grad.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), color);
  });
  return grad;
}

export async function buildCardImage(input: CardInput): Promise<Buffer> {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");

  // Border: rounded-rect gradient slab, inner photo clipped inside.
  const stops = RARITY_STOPS[input.rarity] ?? RARITY_STOPS["common"] ?? ["#9CA3AF"];
  ctx.fillStyle = gradientFor(ctx, stops);
  roundRectPath(ctx, CARD_W, CARD_H, RADIUS);
  ctx.fill();

  const inner = BORDER;
  const iw = CARD_W - inner * 2;
  const ih = CARD_H - inner * 2;
  ctx.save();
  roundRectPath(ctx, CARD_W, CARD_H, RADIUS);
  ctx.clip();
  ctx.translate(inner, inner);

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
  ctx.fillText(input.memberName, pad, ih - 118, iw - pad * 2);
  if (input.fullName !== null && input.fullName !== "") {
    ctx.font = `400 22px ${bodyFont}, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(input.fullName, pad, ih - 86, iw - pad * 2);
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

  ctx.restore();

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
    const fileName = `${input.cardId}.${hash}.webp`;
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
    if (file.endsWith(".webp") && !live.has(file)) {
      await rm(path.join(outDir, file));
    }
  }
  return built;
}
