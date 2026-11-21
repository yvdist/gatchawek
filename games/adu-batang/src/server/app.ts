import { Hono } from "hono";

import type { Env } from "./env.js";

/** Routes and Durable Object forwarding live here; Phase 3 fills the rest in. */
export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) => c.json({ status: "ok", service: "adu-batang" }, 200));

  // Phase 0 proof that the room DO is reachable over a real WebSocket.
  app.get("/ws/:code", (c) => {
    const room = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(c.req.param("code")));
    return room.fetch(c.req.raw);
  });

  return app;
}
