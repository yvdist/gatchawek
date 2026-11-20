import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let mf: Miniflare;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: `export default { async fetch(req, env) { const u = new URL(req.url); const m = u.pathname.match(/^\\/cards\\/([a-z0-9-]+\\.[0-9a-f]{8}\\.webp)$/); if (m === null) return new Response("Not found", { status: 404 }); const obj = await env.CARDS.get(m[1]); if (obj === null) return new Response("Not found", { status: 404 }); return new Response(await obj.arrayBuffer(), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } }); } }`,
    r2Buckets: ["CARDS"],
  });
});

afterAll(async () => {
  await mf.dispose();
});

describe("cards R2 route contract", () => {
  it("serves a stored frame with image content-type", async () => {
    const bucket = await mf.getR2Bucket("CARDS");
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    await bucket.put("salman-yahudi-01.3ec2f298.webp", bytes);
    const res = await mf.dispatchFetch(
      "http://localhost/cards/salman-yahudi-01.3ec2f298.webp",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect((await res.arrayBuffer()).byteLength).toBe(bytes.length);
  });

  it("404s unknown keys and malformed filenames", async () => {
    const missing = await mf.dispatchFetch(
      "http://localhost/cards/tidak-ada-01.12345678.webp",
    );
    expect(missing.status).toBe(404);
    const bad = await mf.dispatchFetch("http://localhost/cards/../secret.txt");
    expect(bad.status).toBe(404);
  });
});
