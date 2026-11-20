import { Hono } from "hono";
import {
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { verifyDiscordRequest } from "./discord/verify.js";
import { commandHandlers } from "./commands/registry.js";
import { handleGachaAgain } from "./commands/gacha/handler.js";
import {
  handleKoleksiGrupAutocomplete,
  handleKoleksiPage,
} from "./commands/koleksi/handler.js";
import {
  handleTradeAutocomplete,
  handleTradeClick,
} from "./commands/trade/handler.js";
import { handleCariAutocomplete } from "./commands/cari/handler.js";
import { handlePamerAutocomplete } from "./commands/pamer/handler.js";
import { ephemeralResponse } from "./discord/rest.js";
import { handleInjectClick } from "./commands/inject-review/handler.js";
import { handleBulkClick } from "./commands/bulk-review/handler.js";
import {
  handleBattleAutocomplete,
  handleBattleComponent,
} from "./commands/battle/handler.js";
import { handleScheduled } from "./scheduled.js";
import type { Env } from "./env.js";
import { registerAdminRoutes } from "./admin/routes.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok" }, 200));

/** Card frames from R2 (persistent; Worker assets can't hold runtime files). */
app.get("/cards/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[a-z0-9-]+\.[0-9a-f]{8}\.webp$/.test(file)) return c.text("Not found", 404);
  const obj = await c.env.CARDS.get(file);
  if (obj === null) return c.text("Not found", 404);
  const headers = new Headers();
  headers.set("Content-Type", "image/webp");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  const etag = obj.httpEtag;
  if (etag !== undefined && etag !== "") headers.set("ETag", etag);
  return new Response(await obj.arrayBuffer(), { headers });
});
registerAdminRoutes(app);

app.post("/interactions", async (c) => {
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  const body = await c.req.text();
  if (signature === undefined || timestamp === undefined) {
    return c.text("Bad request signature", 401);
  }
  const ok = await verifyDiscordRequest(
    body,
    signature,
    timestamp,
    c.env.DISCORD_PUBLIC_KEY,
  );
  if (!ok) return c.text("Bad request signature", 401);

  let interaction: APIInteraction;
  try {
    interaction = JSON.parse(body) as APIInteraction;
  } catch {
    return c.text("Bad request", 400);
  }
  if (interaction.type === InteractionType.Ping) {
    return c.json({ type: InteractionResponseType.Pong });
  }
  if (interaction.type === InteractionType.ApplicationCommand) {
    const command = interaction as APIChatInputApplicationCommandInteraction;
    const handler = commandHandlers.get(command.data.name);
    if (handler === undefined) {
      return c.json({ error: "Unknown command" }, 400);
    }
    return c.json(
      await handler(command, c.env, (p) => c.executionCtx.waitUntil(p)),
    );
  }
  if (interaction.type === InteractionType.MessageComponent) {
    const component = interaction as APIMessageComponentInteraction;
    const customId =
      "custom_id" in component.data ? component.data.custom_id : "";
    const [ns, action] = customId.split(":");
    if (ns === "gacha" && action === "again") {
      return c.json(
        await handleGachaAgain(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "koleksi" && action === "p") {
      return c.json(
        await handleKoleksiPage(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "trade") {
      return c.json(
        await handleTradeClick(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "inject") {
      return c.json(
        await handleInjectClick(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "bulk") {
      return c.json(
        await handleBulkClick(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "battle") {
      return c.json(
        await handleBattleComponent(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    return c.json(ephemeralResponse("Tombol kedaluwarsa."));
  }
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    const autocomplete =
      interaction as unknown as Parameters<typeof handleKoleksiGrupAutocomplete>[0];
    if (autocomplete.data.name === "koleksi") {
      return c.json(await handleKoleksiGrupAutocomplete(autocomplete, c.env));
    }
    if (autocomplete.data.name === "trade") {
      return c.json(
        await handleTradeAutocomplete(
          autocomplete as unknown as Parameters<typeof handleTradeAutocomplete>[0],
          c.env,
        ),
      );
    }
    if (autocomplete.data.name === "cari") {
      return c.json(
        await handleCariAutocomplete(
          autocomplete as unknown as Parameters<typeof handleCariAutocomplete>[0],
          c.env,
        ),
      );
    }
    if (autocomplete.data.name === "pamer") {
      return c.json(
        await handlePamerAutocomplete(
          autocomplete as unknown as Parameters<typeof handlePamerAutocomplete>[0],
          c.env,
        ),
      );
    }
    if (autocomplete.data.name === "battle") {
      return c.json(
        await handleBattleAutocomplete(
          autocomplete as unknown as Parameters<typeof handleBattleAutocomplete>[0],
          c.env,
        ),
      );
    }
    return c.json(ephemeralResponse("Autocomplete tidak tersedia."));
  }
  return c.json({ error: "Unhandled interaction type" }, 400);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
