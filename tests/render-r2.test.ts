import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCardImage, registerFonts } from "../scripts/lib/build-cards.js";
import { fileURLToPath } from "node:url";

// 1x1 PNG (red). buildCardImage must upscale, not crash: inject photos from
// chat uploads are routinely smaller than the MIN_WIDTH/MIN_HEIGHT gate.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});

describe("buildCardImage", () => {
  it("renders a frame from a tiny raw instead of throwing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gatchawek-card-"));
    dirs.push(dir);
    const rawPath = path.join(dir, "x-01.png");
    await writeFile(rawPath, TINY_PNG);
    registerFonts(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "scripts",
        "fonts",
      ),
    );
    const buf = await buildCardImage({
      cardId: "x-01",
      badge: "NGEBUL",
      memberName: "Salman Yahudi",
      photoLabel: null,
      fullName: null,
      rarity: "rare",
      serial: 13,
      photoNo: 1,
      photoTotal: 1,
      rawPath,
      focusX: 0.5,
      focusY: 0.35,
    });
    // RIFF....WEBP header + non-trivial payload.
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
