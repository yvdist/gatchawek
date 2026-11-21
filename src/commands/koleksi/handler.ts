import {
  ApplicationCommandOptionType,
  ComponentType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  type APIEmbed,
  type APIMessageComponentInteraction,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { and, asc, eq, like, sql } from "drizzle-orm";
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
  ownerGate,
  parseKoleksiCardSelectCustomId,
  parseKoleksiPageCustomId,
  parseKoleksiPamerCustomId,
} from "../../domain/koleksi.js";
import {
  getKoleksiPage,
  type KoleksiFilters,
  type KoleksiOutcome,
} from "../../db/queries/koleksi.js";
import { groups, pools } from "../../db/schema.js";
import { getShowcaseCard } from "../../db/queries/pamer.js";
import { pickHype } from "../../domain/pamer.js";
import {
  buildKoleksiCardEmbed,
  buildKoleksiEmbed,
  koleksiCardPamerRow,
  koleksiCardPickerOverflow,
  koleksiCardSelectRows,
  koleksiNavRow,
} from "../../ui/koleksiEmbed.js";
import { buildPamerEmbed, cardImageUrl } from "../../ui/pamerEmbed.js";
import { cryptoRandom } from "../pamer/handler.js";
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
  return option.value;
}

function publicOption(
  interaction: APIChatInputApplicationCommandInteraction,
): boolean {
  const option = interaction.data.options?.find((o) => o.name === "publik");
  return (
    option !== undefined &&
    option.type === ApplicationCommandOptionType.Boolean &&
    option.value === true
  );
}

function groupLabel(poolName: string, groupName: string | null): string {
  return groupName ?? poolName;
}

/**
 * One page's message body: card selects first, then the nav row.
 * Discord allows 5 action rows, so selects cap at 4 (100 cards).
 */
function pageBody(
  ownerId: string,
  poolId: string,
  groupIdForNav: string,
  outcome: Extract<KoleksiOutcome, { status: "ok" }>,
  filters: KoleksiFilters,
): {
  embeds: APIEmbed[];
  components: APIMessageTopLevelComponent[];
} {
  // Single page: no nav buttons. Prev and Next would carry the same page
  // number, producing duplicate custom_ids that Discord rejects with
  // COMPONENT_CUSTOM_ID_DUPLICATED.
  const nav: APIMessageTopLevelComponent[] =
    outcome.totalPages <= 1
      ? []
      : [
          koleksiNavRow(
            ownerId,
            poolId,
            groupIdForNav,
            outcome.page,
            outcome.totalPages,
          ),
        ];
  const embed = buildKoleksiEmbed({
    viewerId: ownerId,
    poolName: outcome.poolName,
    poolEmoji: outcome.poolEmoji,
    groupLabel: groupLabel(outcome.poolName, outcome.groupName),
    members: outcome.members,
    page: outcome.page,
    totalPages: outcome.totalPages,
    groupOwned: outcome.groupOwned,
    groupTotal: outcome.groupTotal,
    filters,
  });
  const overflow = koleksiCardPickerOverflow(outcome.members);
  if (overflow > 0) {
    embed.description = `${embed.description ?? ""}\n\n… +${overflow} kartu lain di halaman ini tidak masuk dropdown (pakai Prev/Next).`.slice(
      0,
      4096,
    );
  }
  return {
    embeds: [embed],
    components: [...koleksiCardSelectRows(ownerId, outcome.members), ...nav],
  };
}

async function followupKoleksiPage(
  env: Env,
  appId: string,
  token: string,
  userId: string,
  filters: KoleksiFilters,
  groupIdForNav: string,
  page: number,
  isPublic: boolean,
): Promise<void> {
  const db = createDb(env);
  const outcome = await getKoleksiPage(db, userId, filters, page);
  switch (outcome.status) {
    case "unknown-pool":
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Pool tak dikenal. Pilih pool yang tersedia.",
        flags: 64,
      });
      return;
    case "unknown-group":
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Grup itu sudah tidak ada / berubah. Buka /koleksi lagi dan pilih grup dari daftar terbaru.",
        flags: 64,
      });
      return;
    case "empty":
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Kamu belum punya kartu di cakupan ini.",
        flags: 64,
      });
      return;
    case "ok": {
      const body = pageBody(
        userId,
        filters.poolId,
        groupIdForNav,
        outcome,
        filters,
      );
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        ...body,
        ...(isPublic ? {} : { flags: 64 as const }),
      });
      return;
    }
  }
}

export function handleKoleksi(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  const poolId = stringOption(interaction, "pool");
  if (userId === null || poolId === null) {
    return ephemeralResponse("Pool belum tersedia. Coba lagi nanti.");
  }
  const groupRaw = stringOption(interaction, "grup");
  const groupId =
    groupRaw === null || groupRaw === "" || groupRaw === "*" ? null : groupRaw;
  const isPublic = publicOption(interaction);
  const filters: KoleksiFilters = { poolId, groupId };
  waitUntil(
    (async () => {
      try {
        await followupKoleksiPage(
          env,
          interaction.application_id,
          interaction.token,
          userId,
          filters,
          groupId ?? "*",
          0,
          isPublic,
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

export function handleKoleksiPage(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const target = parseKoleksiPageCustomId(interaction.data.custom_id);
  if (target === null) {
    return ephemeralResponse("Tombol kedaluwarsa.");
  }
  const clicker = invokerId(interaction);
  if (!ownerGate(clicker, target.ownerId)) {
    return ephemeralResponse(`Tombol ini milik <@${target.ownerId}>.`);
  }
  const { ownerId, poolId, groupId: groupRaw, page } = target;
  const groupId = groupRaw === "*" ? null : groupRaw;
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const outcome = await getKoleksiPage(db, ownerId, { poolId, groupId }, page);
        if (outcome.status !== "ok") {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              content:
                outcome.status === "empty"
                  ? "Kamu belum punya kartu di cakupan ini."
                  : "Cakupan koleksi tidak tersedia lagi.",
            },
          );
          return;
        }
        await patchOriginal(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          pageBody(ownerId, poolId, groupRaw, outcome, { poolId, groupId }),
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

/** Dropdown pick: show one owned card privately with a pamer button. */
export function handleKoleksiCardSelect(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const target = parseKoleksiCardSelectCustomId(interaction.data.custom_id);
  if (target === null) return ephemeralResponse("Tombol kedaluwarsa.");
  const clicker = invokerId(interaction);
  if (!ownerGate(clicker, target.ownerId)) {
    return ephemeralResponse(`Tombol ini milik <@${target.ownerId}>.`);
  }
  const cardId =
    interaction.data.component_type === ComponentType.StringSelect
      ? interaction.data.values[0]
      : undefined;
  if (cardId === undefined) {
    return ephemeralResponse("Pilih kartu dari dropdown dulu.");
  }
  const { ownerId } = target;
  const appId = interaction.application_id;
  const token = interaction.token;
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const card = await getShowcaseCard(db, ownerId, cardId);
        if (card === null) {
          await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
            content: "Kartu tidak tersedia atau bukan milikmu.",
            embeds: [],
            components: [],
          });
          return;
        }
        await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
          embeds: [
            buildKoleksiCardEmbed({
              userId: ownerId,
              card,
              imageUrl: cardImageUrl(env.PUBLIC_BASE_URL, card.imageFile),
            }),
          ],
          components: [koleksiCardPamerRow(ownerId, cardId)],
        });
      } catch {
        try {
          await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
            content: "D1 sibuk/kuota habis, coba lagi.",
          });
        } catch {
          // Never throw out of waitUntil.
        }
      }
    })(),
  );
  // Private placeholder: a type-5 followup would leave a ghost message.
  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: 64 },
  };
}

/** Pamer button on the private card view: post the public pamer embed. */
export function handleKoleksiPamerClick(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const target = parseKoleksiPamerCustomId(interaction.data.custom_id);
  if (target === null) return ephemeralResponse("Tombol kedaluwarsa.");
  const clicker = invokerId(interaction);
  if (!ownerGate(clicker, target.ownerId)) {
    return ephemeralResponse(`Tombol ini milik <@${target.ownerId}>.`);
  }
  const { ownerId, cardId } = target;
  const appId = interaction.application_id;
  const token = interaction.token;
  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const card = await getShowcaseCard(db, ownerId, cardId);
        if (card === null) {
          await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
            content: "Kartu tidak tersedia atau bukan milikmu.",
            embeds: [],
            components: [],
          });
          return;
        }
        await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
          embeds: [
            buildPamerEmbed({
              userId: ownerId,
              memberName: card.memberName,
              photoLabel: card.photoLabel,
              fullName: card.fullName,
              poolName: card.poolName,
              poolEmoji: card.poolEmoji,
              groupName: card.groupName,
              groupBadge: card.groupBadge,
              photoNo: card.photoNo,
              photoTotal: card.photoTotal,
              serial: card.serial,
              rarity: card.rarity,
              quantity: card.quantity,
              caption: null,
              hype: pickHype(card.rarity, cryptoRandom()),
              imageUrl: cardImageUrl(env.PUBLIC_BASE_URL, card.imageFile),
            }),
          ],
        });
      } catch {
        try {
          await patchOriginal(appId, token, env.DISCORD_BOT_TOKEN, {
            content: "D1 sibuk/kuota habis, coba lagi.",
          });
        } catch {
          // Never throw out of waitUntil.
        }
      }
    })(),
  );
  return { type: InteractionResponseType.DeferredMessageUpdate };
}

export async function handleKoleksiGrupAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: number;
    value?: string | number | boolean;
  }[];
  let poolValue: string | null = null;
  let typed = "";
  for (const opt of options) {
    if (opt.name === "pool" && typeof opt.value === "string") poolValue = opt.value;
    if (opt.name === "grup" && typeof opt.value === "string") typed = opt.value;
  }
  try {
    const db = createDb(env);
    if (poolValue !== null && poolValue !== "") {
      const poolRows = await db
        .select({ id: pools.id })
        .from(pools)
        .where(and(eq(pools.id, poolValue), eq(pools.enabled, true)))
        .limit(1);
      if (poolRows[0] !== undefined) {
        const sanitized = typed.replace(/[%_\\]/g, "");
        const rows = await db
          .select({ id: groups.id, name: groups.name })
          .from(groups)
          .where(
            and(
              eq(groups.poolId, poolValue),
              eq(groups.enabled, true),
              sanitized === ""
                ? sql`1 = 1`
                : like(groups.name, `${sanitized}%`),
            ),
          )
          .orderBy(asc(groups.sortOrder))
          .limit(25);
        return {
          type: InteractionResponseType.ApplicationCommandAutocompleteResult,
          data: {
            choices: rows.map((r) => ({ name: r.name.slice(0, 100), value: r.id })),
          },
        };
      }
    }
    const fallback = await db
      .select({ id: groups.id, name: groups.name, poolId: groups.poolId })
      .from(groups)
      .where(eq(groups.enabled, true))
      .orderBy(asc(groups.poolId), asc(groups.sortOrder))
      .limit(25);
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: {
        choices: fallback.map((r) => ({
          name: `${r.name} (${r.poolId})`.slice(0, 100),
          value: r.id,
        })),
      },
    };
  } catch {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
}
