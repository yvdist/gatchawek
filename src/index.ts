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
import { ephemeralResponse } from "./discord/rest.js";
import type { Env } from "./env.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok" }, 200));

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

  const interaction = JSON.parse(body) as APIInteraction;
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
    return c.json(ephemeralResponse("Autocomplete tidak tersedia."));
  }
  return c.json({ error: "Unhandled interaction type" }, 400);
});

export default app;
