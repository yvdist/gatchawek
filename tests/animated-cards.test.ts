import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildAllCards,
  buildCardImage,
  cardFileExtension,
  isAnimatedRarity,
  type CardInput,
} from "../scripts/lib/build-cards.js";

function isGif89a(buf: Buffer): boolean {
  return buf.subarray(0, 6).toString("ascii") === "GIF89a";
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

/** Counts GIF image descriptor blocks (0x2C) outside extension blocks as a quick multi-frame check. */
function hasMultipleGifFrames(buf: Buffer): boolean {
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  expect(width).toBe(400);
  expect(height).toBe(600);
  // Animated GIFs with NETSCAPE2.0 loop extension always contain that block.
  return buf.includes(Buffer.from("NETSCAPE2.0", "ascii"));
}

describe("animated holo & secret cards", () => {
  let workDir: string;
  let rawPath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "gatchawek-anim-"));
    rawPath = path.join(workDir, "sample.png");
    const c = createCanvas(300, 450);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 300, 450);
    ctx.fillStyle = "#f97316";
    ctx.fillRect(40, 60, 220, 260);
    await writeFile(rawPath, await c.encode("png"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function sampleInput(rarity: string, cardId: string): CardInput {
    return {
      cardId,
      badge: "🗿",
      memberName: "Refi",
      photoLabel: "Kaget",
      fullName: null,
      rarity,
      serial: 7,
      photoNo: 1,
      photoTotal: 3,
      rawPath,
      focusX: 0.5,
      focusY: 0.35,
    };
  }

  it("identifies animated rarities and extensions", () => {
    expect(isAnimatedRarity("holo")).toBe(true);
    expect(isAnimatedRarity("secret")).toBe(true);
    expect(isAnimatedRarity("ultra_rare")).toBe(false);
    expect(isAnimatedRarity("common")).toBe(false);
    expect(cardFileExtension("holo")).toBe("gif");
    expect(cardFileExtension("secret")).toBe("gif");
    expect(cardFileExtension("rare")).toBe("webp");
  });

  it("renders static webp for common and looping GIF89a for holo & secret", async () => {
    const commonBuf = await buildCardImage(sampleInput("common", "c-common"));
    expect(isWebp(commonBuf)).toBe(true);

    const holoBuf = await buildCardImage(sampleInput("holo", "c-holo"));
    expect(isGif89a(holoBuf)).toBe(true);
    expect(hasMultipleGifFrames(holoBuf)).toBe(true);
    // Verify Global Color Table flag (bit 7 of logical screen descriptor packed byte at offset 10) is set.
    expect((holoBuf[10] ?? 0) & 0x80).toBe(0x80);

    const secretBuf = await buildCardImage(sampleInput("secret", "c-secret"));
    expect(isGif89a(secretBuf)).toBe(true);
    expect(hasMultipleGifFrames(secretBuf)).toBe(true);
    expect((secretBuf[10] ?? 0) & 0x80).toBe(0x80);
    expect(secretBuf.equals(holoBuf)).toBe(false);
  });

  it("preserves rich gradient color fidelity without 4-bit rgba4444 posterization", async () => {
    const gradPath = path.join(workDir, "smooth-portrait.png");
    const c = createCanvas(400, 600);
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 400, 600);
    g.addColorStop(0, "#1f2937");
    g.addColorStop(0.35, "#9a3412");
    g.addColorStop(0.65, "#fdba74");
    g.addColorStop(1, "#312e81");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 600);
    await writeFile(gradPath, await c.encode("png"));

    const holoBuf = await buildCardImage({
      ...sampleInput("holo", "c-grad-holo"),
      rawPath: gradPath,
    });
    // Extract unique RGB triplets from the 256-entry Global Color Table (offset 13, 256 * 3 bytes).
    const gct = holoBuf.subarray(13, 13 + 256 * 3);
    let nonFourBitAlignedEntries = 0;
    for (let i = 0; i < 255; i += 1) {
      const r = gct[i * 3] ?? 0;
      const gr = gct[i * 3 + 1] ?? 0;
      const b = gct[i * 3 + 2] ?? 0;
      // In rgba4444 quantization every channel is a multiple of 17 (0x00, 0x11, ..., 0xFF) or 16.
      if (r % 17 !== 0 || gr % 17 !== 0 || b % 17 !== 0) {
        nonFourBitAlignedEntries += 1;
      }
    }
    expect(nonFourBitAlignedEntries).toBeGreaterThan(100);
  });

  it("buildAllCards writes .gif for holo/secret and .webp for others, pruning stale files", async () => {
    const outDir = path.join(workDir, "out");
    const built1 = await buildAllCards(
      [
        sampleInput("common", "card-a"),
        sampleInput("holo", "card-b"),
        sampleInput("secret", "card-c"),
      ],
      outDir,
    );
    expect(built1.map((b) => path.extname(b.fileName))).toEqual([
      ".webp",
      ".gif",
      ".gif",
    ]);

    // Remove card-b and re-run to ensure stale .gif is pruned.
    const built2 = await buildAllCards(
      [sampleInput("common", "card-a"), sampleInput("secret", "card-c")],
      outDir,
    );
    const files = await readdir(outDir);
    expect(files.sort()).toEqual(built2.map((b) => b.fileName).sort());
  });
});

describe("cards R2 .gif serving contract", () => {
  let mf: Miniflare;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch(req, env) { const u = new URL(req.url); const m = u.pathname.match(/^\\/cards\\/([a-z0-9-]+\\.[0-9a-f]{8}\\.(webp|gif))$/); if (m === null) return new Response("Not found", { status: 404 }); const obj = await env.CARDS.get(m[1]); if (obj === null) return new Response("Not found", { status: 404 }); const ct = m[1].endsWith(".gif") ? "image/gif" : "image/webp"; return new Response(await obj.arrayBuffer(), { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable" } }); } }`,
      r2Buckets: ["CARDS"],
    });
  });

  afterAll(async () => {
    await mf.dispose();
  });

  it("serves .gif frames with image/gif content-type", async () => {
    const bucket = await mf.getR2Bucket("CARDS");
    const gifBytes = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary");
    await bucket.put("refi-01.abcdef12.gif", gifBytes);
    const res = await mf.dispatchFetch(
      "http://localhost/cards/refi-01.abcdef12.gif",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect((await res.arrayBuffer()).byteLength).toBe(gifBytes.length);
  });
});
