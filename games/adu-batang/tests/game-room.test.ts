import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real workerd proof for P0-T6: bundle the worker app + Durable Object classes,
 * run them in Miniflare, and round-trip one WebSocket message through the
 * Hibernation API (`ctx.acceptWebSocket` → `webSocketMessage` → echo).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

let runtime: Miniflare | undefined;
let dir = "";
let baseUrl = "";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "adu-batang-do-"));
  const outfile = path.join(dir, "worker.mjs");
  await build({
    entryPoints: [path.join(HERE, "fixtures", "test-worker.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile,
    logLevel: "silent",
  });
  runtime = new Miniflare({
    modules: true,
    scriptPath: outfile,
    // Newest date the locally installed workerd (via Miniflare) accepts.
    compatibilityDate: "2026-08-06",
    port: 0,
    durableObjects: {
      GAME_ROOM: { className: "GameRoom", useSQLite: true },
      MATCHMAKER: { className: "Matchmaker", useSQLite: true },
    },
  });
  // Miniflare hands out a URL with a trailing slash; keep joins single-slashed.
  baseUrl = (await runtime.ready).toString().replace(/\/$/, "");
}, 60_000);

afterAll(async () => {
  await runtime?.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function echoThroughRoom(room: string, text: string): Promise<string> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/${room}`);
  const opened = Promise.withResolvers<string>();
  socket.addEventListener("open", () => { opened.resolve("open"); }, { once: true });
  socket.addEventListener("error", () => { opened.reject(new Error("WebSocket gagal terbuka")); }, { once: true });
  AbortSignal.timeout(5_000).addEventListener("abort", () => { opened.reject(new Error("WebSocket tidak terbuka")); }, { once: true });
  try {
    await opened.promise;
    const echo = Promise.withResolvers<string>();
    socket.addEventListener("message", (event) => { echo.resolve(String(event.data)); }, { once: true });
    AbortSignal.timeout(5_000).addEventListener("abort", () => { echo.reject(new Error("tidak ada echo dalam 5 detik")); }, { once: true });
    socket.send(text);
    return await echo.promise;
  } finally {
    socket.close();
  }
}

describe("GameRoom ping-pong", () => {
  it("serves the health endpoint", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "adu-batang" });
  });

  it("echoes one message through the hibernating room", async () => {
    await expect(echoThroughRoom("lobby-uji", "halo batang")).resolves.toBe("echo: halo batang");
  });

  it("rejects a plain HTTP request to the room route", async () => {
    const res = await fetch(`${baseUrl}/ws/lobby-uji`);
    expect(res.status).toBe(426);
  });
});
