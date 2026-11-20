import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  buildCardImage,
  registerFonts,
} from "../scripts/lib/build-cards.js";
import { RARITY_KEYS } from "../shared/manifest.schema.js";

let tempDir = "";
let rawImagePath = "";

beforeAll(async () => {
  registerFonts(path.resolve("scripts", "fonts"));
  tempDir = await mkdtemp(path.join(tmpdir(), "gatchawek-card-ui-"));
  rawImagePath = path.join(tempDir, "sample.png");
  const c = createCanvas(400, 600);
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 400, 600);
  g.addColorStop(0, "#334155");
  g.addColorStop(1, "#0f172a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 400, 600);
  await writeFile(rawImagePath, c.toBuffer("image/png"));
});

afterAll(async () => {
  if (tempDir !== "") {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("buildCardImage v3", () => {
  it("renders every rarity at 600x900 under 150KB WebP", async () => {
    const buffers: Buffer[] = [];
    for (const [idx, rarity] of RARITY_KEYS.entries()) {
      const buf = await buildCardImage({
        cardId: `test-${rarity}`,
        badge: "NGEBUL",
        memberName: "Refi",
        photoLabel: "Refi Kaget",
        fullName: null,
        rarity,
        serial: idx + 1,
        photoNo: 1,
        photoTotal: 1,
        rawPath: rawImagePath,
        focusX: 0.5,
        focusY: 0.35,
      });
      expect(buf.length).toBeGreaterThan(1000);
      expect(buf.length).toBeLessThan(150 * 1024);
      const decoded = await loadImage(buf);
      expect(decoded.width).toBe(CARD_W);
      expect(decoded.height).toBe(CARD_H);
      buffers.push(buf);
    }
    const uniqueHashes = new Set(buffers.map((b) => b.toString("base64").slice(0, 120)));
    expect(uniqueHashes.size).toBe(RARITY_KEYS.length);
  });

  it("handles unlabeled members with fullName fallback", async () => {
    const buf = await buildCardImage({
      cardId: "kmp-01",
      badge: "KMP",
      memberName: "Prabowo",
      photoLabel: null,
      fullName: "Prabowo Subianto",
      rarity: "secret",
      serial: 77,
      photoNo: 1,
      photoTotal: 1,
      rawPath: rawImagePath,
      focusX: 0.5,
      focusY: 0.35,
    });
    const decoded = await loadImage(buf);
    expect(decoded.width).toBe(CARD_W);
    expect(decoded.height).toBe(CARD_H);
  });
});
