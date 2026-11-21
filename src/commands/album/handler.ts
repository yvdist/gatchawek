import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIApplicationCommandAutocompleteResponse,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import {
  createAlbumToken,
  redeemAlbumToken,
  searchAlbumPools,
} from "../../db/queries/album.js";
import {
  ephemeralResponse,
  patchOriginal,
} from "../../discord/rest.js";
import {
  generateAlbumTokenHex,
  isLinkPreviewCrawler,
  isValidAlbumToken,
} from "../../domain/album.js";
import type { Env } from "../../env.js";
import { reportError } from "../../observability.js";
import {
  buildAlbumEmbed,
  buildAlbumLinkRow,
  buildAlbumUrl,
} from "../../ui/albumEmbed.js";
import {
  albumBinderPage,
  albumCrawlerPreviewPage,
  albumExpiredPage,
} from "../../ui/albumHtml.js";
import { extractCallerIdentity } from "../kartu/handler.js";
import type { WaitUntil } from "../registry.js";

function stringOption(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const option = interaction.data.options?.find((o) => o.name === name);
  if (
    option === undefined ||
    option.type !== ApplicationCommandOptionType.String
  ) {
    return null;
  }
  const trimmed = option.value.trim();
  return trimmed === "" ? null : trimmed;
}

export function handleAlbum(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const caller = extractCallerIdentity(interaction);
  if (caller === null) {
    return ephemeralResponse(
      "Tidak dapat mengenali pengguna. Coba lagi di dalam server.",
    );
  }
  const poolId = stringOption(interaction, "pool");

  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const nowSec = Math.floor(Date.now() / 1000);
        const randomBytes = new Uint8Array(24);
        crypto.getRandomValues(randomBytes);
        const token = generateAlbumTokenHex(randomBytes);

        const outcome = await createAlbumToken(db, {
          token,
          userId: caller.userId,
          displayName: caller.displayName,
          avatarUrl: caller.avatarUrl,
          poolId,
          now: nowSec,
        });

        if (outcome.status === "unknown-pool") {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              content:
                "Pool tidak ditemukan. Pilih pool yang tersedia dari daftar autocomplete.",
            },
          );
          return;
        }

        const albumUrl = buildAlbumUrl(env.PUBLIC_BASE_URL, outcome.token);
        const embed = buildAlbumEmbed({
          userId: caller.userId,
          albumUrl,
          expiresAt: outcome.expiresAt,
          poolName: outcome.poolName,
          poolEmoji: outcome.poolEmoji,
          summary: outcome.summary,
        });

        await patchOriginal(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            embeds: [embed],
            components: [buildAlbumLinkRow(albumUrl)],
          },
        );
      } catch (err) {
        reportError("album", err);
        try {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              content:
                "Gagal membuat tautan buku koleksi saat ini. Silakan coba lagi.",
            },
          );
        } catch {
          // Never throw out of waitUntil.
        }
      }
    })(),
  );

  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: 64 },
  };
}

export async function handleAlbumAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIApplicationCommandAutocompleteResponse> {
  const focused = interaction.data.options.find(
    (o): o is { name: string; type: 3; value: string; focused: true } =>
      "focused" in o && o.focused === true,
  );
  if (focused === undefined || focused.name !== "pool") {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
  try {
    const db = createDb(env);
    const choices = await searchAlbumPools(db, focused.value);
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices },
    };
  } catch {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
}

export async function handleAlbumWebRequest(args: {
  token: string;
  userAgent: string | null | undefined;
  method: string;
  env: Env;
}): Promise<{ status: 200 | 404 | 410; html: string }> {
  if (!isValidAlbumToken(args.token)) {
    return { status: 404, html: albumExpiredPage("not-found") };
  }
  if (
    args.method.toUpperCase() === "HEAD" ||
    isLinkPreviewCrawler(args.userAgent)
  ) {
    return { status: 200, html: albumCrawlerPreviewPage() };
  }

  const db = createDb(args.env);
  const nowSec = Math.floor(Date.now() / 1000);
  const outcome = await redeemAlbumToken(db, {
    token: args.token,
    claimToken: crypto.randomUUID(),
    now: nowSec,
    publicBaseUrl: args.env.PUBLIC_BASE_URL,
  });

  switch (outcome.status) {
    case "ok":
      return { status: 200, html: albumBinderPage(outcome.binder) };
    case "already-used":
      return {
        status: 410,
        html: albumExpiredPage("already-used", outcome.usedAt),
      };
    case "expired":
      return {
        status: 410,
        html: albumExpiredPage("expired", outcome.expiresAt),
      };
    case "not-found":
      return { status: 404, html: albumExpiredPage("not-found") };
  }
}
