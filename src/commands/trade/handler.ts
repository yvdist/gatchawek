import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import type { Env } from "../../env.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import {
  canClickTrade,
  parseTradeCustomId,
  type TradeValidationError,
} from "../../domain/trade.js";
import {
  acceptTrade,
  createTrade,
  getTradeById,
  getTradeCardViews,
  resolveTrade,
  searchTradableCards,
  type TradeCardView,
} from "../../db/queries/trade.js";
import {
  buildTradeEmbed,
  tradeButtons,
  type TradeEmbedStatus,
} from "../../ui/tradeEmbed.js";
import type { WaitUntil } from "../registry.js";

function optionValue(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const options = interaction.data.options ?? [];
  for (const opt of options) {
    if (
      opt.name === name &&
      opt.type === ApplicationCommandOptionType.User &&
      typeof opt.value === "string"
    ) {
      return opt.value;
    }
    if (
      opt.name === name &&
      opt.type === ApplicationCommandOptionType.String &&
      typeof opt.value === "string"
    ) {
      return opt.value;
    }
  }
  return null;
}

function friendlyReject(reason: TradeValidationError): string {
  switch (reason) {
    case "self-trade":
      return "Tidak bisa tukar dengan diri sendiri.";
    case "bot-target":
      return "Tidak bisa tukar dengan bot.";
    case "same-card":
      return "Kartu yang ditawarkan dan diminta harus berbeda.";
    case "offer-not-owned":
      return "Kamu tidak punya kartu yang ditawarkan.";
    case "request-not-owned":
      return "Dia tidak punya kartu yang kamu mau.";
    case "offer-disabled":
      return "Kartu yang ditawarkan sudah tidak tersedia.";
    case "request-disabled":
      return "Kartu yang diminta sudah tidak tersedia.";
    case "pending-limit":
      return "Kamu sudah punya 3 tawaran pending. Tunggu diproses dulu.";
  }
}

async function cardViewsOrNull(
  env: Env,
  cardIds: readonly [string, string],
): Promise<Map<string, TradeCardView> | null> {
  try {
    return await getTradeCardViews(createDb(env), cardIds);
  } catch {
    return null;
  }
}

export function handleTrade(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const proposerId = invokerId(interaction);
  const targetId = optionValue(interaction, "user");
  const offer = optionValue(interaction, "offer");
  const request = optionValue(interaction, "request");
  if (proposerId === null || targetId === null || offer === null || request === null) {
    return ephemeralResponse("Opsi trade tidak lengkap. Coba lagi.");
  }
  if (proposerId === targetId) {
    return ephemeralResponse(friendlyReject("self-trade"));
  }
  if (targetId === interaction.application_id) {
    return ephemeralResponse(friendlyReject("bot-target"));
  }
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const outcome = await createTrade(db, {
          proposerId,
          targetId,
          targetIsBot: false,
          offerCardId: offer,
          requestCardId: request,
          now: Math.floor(Date.now() / 1000),
        });
        if (outcome.status === "rejected") {
          await postFollowup(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: friendlyReject(outcome.reason), flags: 64 },
          );
          return;
        }
        const views = await getTradeCardViews(db, [offer, request]);
        const offerView = views.get(offer);
        const requestView = views.get(request);
        if (offerView === undefined || requestView === undefined) {
          await postFollowup(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Kartu tidak ditemukan lagi.", flags: 64 },
          );
          return;
        }
        const row = await getTradeById(db, outcome.tradeId);
        await postFollowup(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            embeds: [
              buildTradeEmbed({
                proposerId,
                targetId,
                offer: offerView,
                request: requestView,
                status: "pending",
                expiresAt: row?.expiresAt ?? 0,
              }),
            ],
            components: [tradeButtons(outcome.tradeId)],
          },
        );
      } catch {
        try {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "D1 sibuk/kuota habis, coba lagi." },
          );
        } catch {
          // Never throw out of waitUntil.
        }
      }
    })(),
  );
  return deferredResponse();
}

function statusForAccept(
  outcome: "accepted" | "expired" | "ownership-changed",
): TradeEmbedStatus {
  if (outcome === "ownership-changed") return "failed";
  return outcome;
}

export async function handleTradeClick(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): Promise<APIInteractionResponse> {
  const parsed = parseTradeCustomId(
    "custom_id" in interaction.data ? interaction.data.custom_id : "",
  );
  if (parsed === null) return ephemeralResponse("Tombol kedaluwarsa.");
  const clickerId = invokerId(interaction);

  if (parsed.action === "accept") {
    if (clickerId === null) return ephemeralResponse("Tombol ini bukan untukmu.");
    waitUntil(
      (async () => {
        try {
          const db = createDb(env);
          const row = await getTradeById(db, parsed.tradeId);
          if (row === null) {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Tawaran sudah tidak tersedia." },
            );
            return;
          }
          if (!canClickTrade("accept", clickerId, row.proposerId, row.targetId)) {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Tombol ini bukan untukmu." },
            );
            return;
          }
          const now = Math.floor(Date.now() / 1000);
          if (row.expiresAt <= now) {
            await resolveTrade(db, parsed.tradeId, "cancelled", now).catch(
              () => false,
            );
            const views = await cardViewsOrNull(env, [
              row.offerCardId,
              row.requestCardId,
            ]);
            const offer = views?.get(row.offerCardId);
            const request = views?.get(row.requestCardId);
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              offer !== undefined && request !== undefined
                ? {
                    embeds: [
                      buildTradeEmbed({
                        proposerId: row.proposerId,
                        targetId: row.targetId,
                        offer,
                        request,
                        status: "expired",
                        expiresAt: row.expiresAt,
                      }),
                    ],
                    components: [],
                  }
                : { content: "Tawaran sudah kedaluwarsa." },
            );
            return;
          }
          const outcome = await acceptTrade(db, parsed.tradeId, now);
          if (outcome.status === "not-found") {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Tawaran sudah tidak tersedia." },
            );
            return;
          }
          if (outcome.status === "already-resolved") {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Tawaran sudah diproses." },
            );
            return;
          }
          const views = await cardViewsOrNull(env, [
            row.offerCardId,
            row.requestCardId,
          ]);
          const offer = views?.get(row.offerCardId);
          const request = views?.get(row.requestCardId);
          if (offer === undefined || request === undefined) {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Kartu tidak ditemukan lagi." },
            );
            return;
          }
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              embeds: [
                buildTradeEmbed({
                  proposerId: row.proposerId,
                  targetId: row.targetId,
                  offer,
                  request,
                  status: statusForAccept(outcome.status),
                  expiresAt: row.expiresAt,
                }),
              ],
              components: [],
            },
          );
        } catch {
          try {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "D1 sibuk/kuota habis, coba lagi." },
            );
          } catch {
            // Never throw out of waitUntil.
          }
        }
      })(),
    );
    return { type: InteractionResponseType.DeferredMessageUpdate };
  }

  // decline / cancel: single guarded UPDATE, answered inline (type 7).
  if (clickerId === null) return ephemeralResponse("Tombol ini bukan untukmu.");
  try {
    const db = createDb(env);
    const row = await getTradeById(db, parsed.tradeId);
    if (row === null) return ephemeralResponse("Tombol kedaluwarsa.");
    if (!canClickTrade(parsed.action, clickerId, row.proposerId, row.targetId)) {
      return ephemeralResponse("Tombol ini bukan untukmu.");
    }
    const now = Math.floor(Date.now() / 1000);
    const finalStatus =
      row.expiresAt <= now
        ? ("expired" as const)
        : parsed.action === "decline"
          ? ("declined" as const)
          : ("cancelled" as const);
    if (row.expiresAt > now) {
      const ok = await resolveTrade(
        db,
        parsed.tradeId,
        parsed.action === "decline" ? "declined" : "cancelled",
        now,
      );
      if (!ok) return ephemeralResponse("Tawaran sudah diproses.");
    } else {
      await resolveTrade(db, parsed.tradeId, "cancelled", now);
    }
    const views = await getTradeCardViews(db, [
      row.offerCardId,
      row.requestCardId,
    ]);
    const offer = views.get(row.offerCardId);
    const request = views.get(row.requestCardId);
    if (offer === undefined || request === undefined) {
      return {
        type: InteractionResponseType.UpdateMessage,
        data: { content: "Tawaran diproses.", components: [] },
      };
    }
    return {
      type: InteractionResponseType.UpdateMessage,
      data: {
        embeds: [
          buildTradeEmbed({
            proposerId: row.proposerId,
            targetId: row.targetId,
            offer,
            request,
            status: finalStatus,
            expiresAt: row.expiresAt,
          }),
        ],
        components: [],
      },
    };
  } catch {
    return ephemeralResponse("D1 sibuk/kuota habis, coba lagi.");
  }
}

export async function handleTradeAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: number;
    value?: string | number | boolean;
    focused?: boolean;
  }[];
  let focused: string | null = null;
  let typed = "";
  const proposerId: string | null = invokerId(interaction);
  let targetId: string | null = null;
  for (const opt of options) {
    if (opt.focused === true) {
      focused = opt.name;
      if (typeof opt.value === "string") typed = opt.value;
    } else if (opt.name === "user" && typeof opt.value === "string") {
      targetId = opt.value;
    }
  }
  try {
    const db = createDb(env);
    if (focused === "offer") {
      if (proposerId === null) {
        return {
          type: InteractionResponseType.ApplicationCommandAutocompleteResult,
          data: { choices: [] },
        };
      }
      const choices = await searchTradableCards(db, proposerId, typed);
      return {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: choices.map((c) => ({ name: c.label, value: c.id })),
        },
      };
    }
    if (focused === "request") {
      if (targetId === null || targetId === "") {
        return {
          type: InteractionResponseType.ApplicationCommandAutocompleteResult,
          data: { choices: [] },
        };
      }
      const choices = await searchTradableCards(db, targetId, typed);
      return {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: choices.map((c) => ({ name: c.label, value: c.id })),
        },
      };
    }
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  } catch {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
}
