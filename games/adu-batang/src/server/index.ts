import { withSentry } from "@sentry/cloudflare";

import { createApp } from "./app.js";
import type { Env } from "./env.js";

export { GameRoom } from "./durable/game-room.js";
export { Matchmaker } from "./durable/matchmaker.js";

const app = createApp();

export default withSentry<Env>(
  (env) => (env.SENTRY_DSN === undefined || env.SENTRY_DSN === "" ? undefined : { dsn: env.SENTRY_DSN }),
  { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
);
