import { Hono } from "hono";

/** Routes and Durable Object forwarding live here; Phase 3 fills them in. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok", service: "adu-batang" }, 200));

  return app;
}
