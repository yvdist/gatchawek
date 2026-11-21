import { describe, expect, it } from "vitest";
import { app } from "../src/index.js";

const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // %PDF-1.7

function envWithNotes(keys: readonly string[]): Parameters<typeof app.request>[2] {
  return {
    CARDS: {
      get: async (key: string) =>
        keys.includes(key)
          ? { arrayBuffer: async () => PDF_BYTES.buffer, httpEtag: '"e"' }
          : null,
    },
  } as unknown as Parameters<typeof app.request>[2];
}

describe("GET /notes/:file", () => {
  it("serves a stored note inline as PDF", async () => {
    const res = await app.request(
      "/notes/insiden-2026-11-21-d1-quota.pdf",
      {},
      envWithNotes(["notes/insiden-2026-11-21-d1-quota.pdf"]),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect((await res.arrayBuffer()).byteLength).toBe(PDF_BYTES.length);
  });

  it("404s a missing note and a name that is not a note", async () => {
    const missing = await app.request(
      "/notes/tidak-ada.pdf",
      {},
      envWithNotes([]),
    );
    expect(missing.status).toBe(404);

    const wrongExt = await app.request(
      "/notes/insiden.html",
      {},
      envWithNotes(["notes/insiden.html"]),
    );
    expect(wrongExt.status).toBe(404);

    const traversal = await app.request(
      "/notes/..%2Fsecret.pdf",
      {},
      envWithNotes(["secret.pdf"]),
    );
    expect(traversal.status).toBe(404);
  });
});
