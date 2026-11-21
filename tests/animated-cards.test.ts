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

    const secretBuf = await buildCardImage(sampleInput("secret", "c-secret"));
    expect(isGif89a(secretBuf)).toBe(true);
    expect(hasMultipleGifFrames(secretBuf)).toBe(true);
    expect(secretBuf.equals(holoBuf)).toBe(false);
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
