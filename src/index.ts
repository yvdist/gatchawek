import { Hono, type MiddlewareHandler } from "hono";
import { sentry } from "@sentry/hono/cloudflare";
import {
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { verifyDiscordRequest } from "./discord/verify.js";
import { commandHandlers } from "./commands/registry.js";
import { handleGachaAgain } from "./commands/gacha/handler.js";
import {
  handleKoleksiCardSelect,
  handleKoleksiGrupAutocomplete,
  handleKoleksiPage,
  handleKoleksiPamerClick,
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
import {
  handleListAutocomplete,
  handleListPage,
} from "./commands/list/handler.js";
import {
  handleUnwishAutocomplete,
  handleWishAutocomplete,
} from "./commands/wish/handler.js";
import {
  handleGiveAutocomplete,
  handleGiveClick,
} from "./commands/give/handler.js";
import { handleDismantleAutocomplete } from "./commands/dismantle/handler.js";
import {
  handleAlbumAutocomplete,
  handleAlbumWebRequest,
} from "./commands/album/handler.js";
import { getShareableCard } from "./db/queries/share.js";
import { createDb, isD1DailyQuotaError } from "./db/client.js";
import { maintenancePage, quotaPage } from "./ui/adminHtml.js";
import { maintenanceMessage, maintenanceUntil } from "./domain/maintenance.js";
import { isLinkPreviewCrawler } from "./domain/album.js";
import { cardImageUrl } from "./ui/gachaEmbed.js";
import {
  cardShareCrawlerPage,
  cardSharePage,
} from "./ui/cardShareHtml.js";
import { handleScheduled } from "./scheduled.js";
import type { Env } from "./env.js";
import { registerAdminRoutes } from "./admin/routes.js";

const app = new Hono<{ Bindings: Env }>();

// Error tracking (Better Stack via Sentry SDK). DSN from Worker secret;
// unset locally = SDK no-ops. Must be first middleware.
app.use(
  sentry(app, (env) => {
    const dsn = (env as Env | undefined)?.SENTRY_DSN;
    return dsn !== undefined ? { dsn } : {};
  }),
);

// A spent D1 free-tier read quota is an outage, not a bug: every SELECT
// fails account-wide until midnight UTC. Answer with a plain page instead of
// a 500 (Sentry already captured the exception before this handler runs).
app.onError((error, c) => {
  if (isD1DailyQuotaError(error)) {
    c.header("Cache-Control", "no-store");
    if (c.req.path.startsWith("/admin")) return c.html(quotaPage(), 503);
    return c.text("Kuota baca database harian habis. Coba lagi setelah 07:00 WIB.", 503);
  }
  return c.text("Internal Server Error", 500);
});

// Scheduled outage window: admin answers without a single database read.
const maintenanceGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const until = maintenanceUntil(c.env.MAINTENANCE_UNTIL, Date.now());
  if (until !== null) {
    c.header("Cache-Control", "no-store");
    return c.html(maintenancePage(until), 503);
  }
  await next();
};
app.use("/admin", maintenanceGate);
app.use("/admin/*", maintenanceGate);

app.get("/health", (c) => c.json({ status: "ok" }, 200));
/**
 * Rendered notes (PDF) from R2. Kept off the database on purpose: an incident
 * write-up must stay readable while D1 is refusing queries.
 */
app.on(["GET", "HEAD"], "/notes/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[a-z0-9-]+\.pdf$/.test(file)) return c.text("Not found", 404);
  const obj = await c.env.CARDS.get(`notes/${file}`);
  if (obj === null) return c.text("Not found", 404);
  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Disposition", `inline; filename="${file}"`);
  return new Response(await obj.arrayBuffer(), { headers });
});
/** Card frames from R2 (persistent; Worker assets can't hold runtime files). */
app.get("/cards/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[a-z0-9-]+\.[0-9a-f]{8}\.(webp|gif)$/.test(file)) {
    return c.text("Not found", 404);
  }
  const obj = await c.env.CARDS.get(file);
  if (obj === null) return c.text("Not found", 404);
  const headers = new Headers();
  headers.set("Content-Type", file.endsWith(".gif") ? "image/gif" : "image/webp");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  const etag = obj.httpEtag;
  if (etag !== undefined && etag !== "") headers.set("ETag", etag);
  return new Response(await obj.arrayBuffer(), { headers });
});
app.on(["GET", "HEAD"], "/album/:token", async (c) => {
  const token = c.req.param("token") ?? "";
  const res = await handleAlbumWebRequest({
    token,
    userAgent: c.req.header("User-Agent"),
    method: c.req.method,
    env: c.env,
  });
  c.header("Cache-Control", "no-store, no-cache, must-revalidate");
  c.header("Referrer-Policy", "no-referrer");
  return c.html(res.html, res.status);
});
app.on(["GET", "HEAD"], "/kartu/:id", async (c) => {
  const cardId = c.req.param("id") ?? "";
  const db = createDb(c.env);
  const card = await getShareableCard(db, cardId);
  c.header("Referrer-Policy", "no-referrer");
  if (card === null || card.enabled !== true) {
    // Never cache a 404: a hidden or taken-down card can come back, and a
    // cached 404 outlives the request that hid it (max-age is an hour).
    c.header("Cache-Control", "no-store");
    return c.text("Not found", 404);
  }
  c.header("Cache-Control", "public, max-age=3600");
  const imageUrl = cardImageUrl(c.env.PUBLIC_BASE_URL, card.imageFile);
  const pageUrl = `${new URL(c.req.url).origin}/kartu/${card.cardId}`;
  const data = { ...card, imageUrl };
  if (
    c.req.method.toUpperCase() === "HEAD" ||
    isLinkPreviewCrawler(c.req.header("User-Agent"))
  ) {
    return c.html(cardShareCrawlerPage(data, pageUrl), 200);
  }
  return c.html(cardSharePage(data, pageUrl), 200);
});
registerAdminRoutes(app);

/** Discord's answer while the outage window is open; never touches the DB. */
function maintenanceReply(
  interaction: APIInteraction,
  untilMs: number,
): APIInteractionResponse {
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
  return ephemeralResponse(maintenanceMessage(untilMs));
}

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
  // Pages and share links must resolve on the deployment that answered, not
  // on the pinned PUBLIC_BASE_URL host (a temp worker answers on its own).
  const origin = new URL(c.req.url).origin;
  const until = maintenanceUntil(c.env.MAINTENANCE_UNTIL, Date.now());
  if (until !== null) {
    return c.json(maintenanceReply(interaction, until));
  }
  if (interaction.type === InteractionType.ApplicationCommand) {
    const command = interaction as APIChatInputApplicationCommandInteraction;
    const handler = commandHandlers.get(command.data.name);
    if (handler === undefined) {
      return c.json({ error: "Unknown command" }, 400);
    }
    return c.json(
      await handler(
        command,
        c.env,
        (p) => c.executionCtx.waitUntil(p),
        origin,
      ),
    );
  }
  if (interaction.type === InteractionType.MessageComponent) {
    const component = interaction as APIMessageComponentInteraction;
    const customId =
      "custom_id" in component.data ? component.data.custom_id : "";
    const [ns, action] = customId.split(":");
    if (ns === "gacha" && action === "again") {
      return c.json(
        await handleGachaAgain(
          component,
          c.env,
          (p) => c.executionCtx.waitUntil(p),
          origin,
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
    if (ns === "koleksi" && action === "d") {
      return c.json(
        await handleKoleksiCardSelect(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "koleksi" && action === "pr") {
      return c.json(
        await handleKoleksiPamerClick(component, c.env, (p) =>
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
    if (ns === "give") {
      return c.json(
        await handleGiveClick(component, c.env, (p) =>
          c.executionCtx.waitUntil(p),
        ),
      );
    }
    if (ns === "list" && action === "p") {
      return c.json(
        await handleListPage(component, c.env, (p) =>
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
    if (autocomplete.data.name === "list") {
      return c.json(
        await handleListAutocomplete(
          autocomplete as unknown as Parameters<typeof handleListAutocomplete>[0],
          c.env,
        ),
      );
    }
    if (autocomplete.data.name === "give" || autocomplete.data.name === "give-to") {
      return c.json(
        await handleGiveAutocomplete(
          autocomplete as unknown as Parameters<typeof handleGiveAutocomplete>[0],
          c.env,
        ),
      );
    }
    if (autocomplete.data.name === "dismantle") {
      return c.json(
        await handleDismantleAutocomplete(
          autocomplete as unknown as Parameters<typeof handleDismantleAutocomplete>[0],
          c.env,
        ),
      );
    }
    if (autocomplete.data.name === "wish") {
      return c.json(await handleWishAutocomplete(autocomplete, c.env));
    }
    if (autocomplete.data.name === "unwish") {
      return c.json(await handleUnwishAutocomplete(autocomplete, c.env));
    }
    if (autocomplete.data.name === "album") {
      return c.json(await handleAlbumAutocomplete(autocomplete, c.env));
    }
    return c.json(ephemeralResponse("Autocomplete tidak tersedia."));
  }
  return c.json({ error: "Unhandled interaction type" }, 400);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
