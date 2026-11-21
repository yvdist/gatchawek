import { describe, expect, it, vi } from "vitest";
import {
  renderFileName,
  renderPool,
  type RenderCard,
  type RenderPoolHooks,
} from "../scripts/lib/render-pool.js";

function card(id: string): RenderCard {
  return {
    id,
    badge: "NGB",
    memberName: "Member",
    photoLabel: null,
    fullName: null,
    rarity: "rare",
    serial: 1,
    photoNo: 1,
    photoTotal: 1,
    imageUrl: `https://cdn.example/${id}.jpg`,
  };
}

function hooks(overrides: Partial<RenderPoolHooks> = {}): RenderPoolHooks & {
  uploads: string[];
  flushes: string[][];
} {
  const uploads: string[] = [];
  const flushes: string[][] = [];
  return {
    uploads,
    flushes,
    rawDir: "/tmp/raw",
    upload: (cardId: string, buffer: Buffer) => {
      uploads.push(cardId);
      return Promise.resolve(renderFileName(cardId, buffer));
    },
    flushUpdates: (batch) => {
      flushes.push(batch.map((u) => u.cardId));
      return Promise.resolve();
    },
    fetchImage: (cardId) => Promise.resolve(`/tmp/raw/${cardId}.jpg`),
    buildImage: (input) => Promise.resolve(Buffer.from(`webp:${input.cardId}`)),
    ...overrides,
  };
}

describe("renderPool", () => {
  it("renders all cards and flushes in batches", async () => {
    const h = hooks();
    const cards = ["a-01", "b-01", "c-01", "d-01", "e-01"].map(card);
    const result = await renderPool(cards, h, { jobs: 2, gapMs: 0, flushEvery: 2 });
    expect(result.updated).toBe(5);
    expect(result.failed).toEqual([]);
    expect(h.uploads).toHaveLength(5);
    expect(h.flushes.flat()).toHaveLength(5);
    // 5 updates in chunks of 2 → 3 flushes.
    expect(h.flushes).toHaveLength(3);
  });

  it("records fetch failures without stopping the batch", async () => {
    const h = hooks({
      fetchImage: (cardId) =>
        cardId === "bad-01"
          ? Promise.resolve({ cardId, imageUrl: "x", reason: "http 404" })
          : Promise.resolve(`/tmp/raw/${cardId}.jpg`),
    });
    const result = await renderPool([card("ok-01"), card("bad-01"), card("ok-02")], h, {
      jobs: 2,
      gapMs: 0,
    });
    expect(result.updated).toBe(2);
    expect(result.failed).toEqual(["bad-01: http 404"]);
  });

  it("trips the 429 breaker and stops scheduling", async () => {
    const fetchImage = vi.fn((_cardId: string) =>
      Promise.resolve({ cardId: _cardId, imageUrl: "x", reason: "http 429" }),
    );
    const h = hooks({ fetchImage });
    const cards = ["r-01", "r-02", "r-03", "r-04"].map(card);
    const result = await renderPool(cards, h, { jobs: 2, gapMs: 0, max429: 2, cooldownMs: 1 });
    expect(result.stopped429).toBe(true);
    expect(result.updated).toBe(0);
    // Breaker stops the run: not every card gets attempted.
    expect(fetchImage.mock.calls.length).toBeLessThan(cards.length);
  });

  it("derives stable hash filenames", () => {
    expect(renderFileName("x-01", Buffer.from("abc"))).toMatch(/^x-01\.[0-9a-f]{8}\.webp$/);
    expect(renderFileName("x-01", Buffer.from("abc"))).toBe(renderFileName("x-01", Buffer.from("abc")));
    expect(renderFileName("x-01", Buffer.from("abc"))).not.toBe(renderFileName("x-01", Buffer.from("abd")));
  });
});
