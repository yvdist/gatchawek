import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { createDb } from "../../db/client.js";
import {
  getListPage,
  searchListGroups,
  searchListPools,
  type ListFilters,
} from "../../db/queries/list.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import { isListButtonOwner, parseListPageCustomId } from "../../domain/list.js";
import type { Env } from "../../env.js";
import { buildListEmbed, listNavRow } from "../../ui/listEmbed.js";
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
  return trimmed === "" || trimmed === "*" ? null : trimmed;
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

async function followupListPage(
  env: Env,
  appId: string,
  token: string,
  userId: string,
  filters: ListFilters,
  page: number,
  isPublic: boolean,
): Promise<void> {
  const db = createDb(env);
  const outcome = await getListPage(db, filters, page);
  switch (outcome.status) {
    case "unknown-pool":
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Pool tak dikenal. Pilih pool yang tersedia.",
        flags: 64,
      });
      return;
    case "unknown-group":
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content:
          "Grup tidak ditemukan atau tidak cocok dengan pool yang dipilih.",
        flags: 64,
      });
      return;
    case "empty":
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        content: "Belum ada kartu yang tersedia di cakupan ini.",
        flags: 64,
      });
      return;
    case "ok": {
      const poolKey = filters.poolId ?? "*";
      const groupKey = filters.groupId ?? "*";
      const nav =
        outcome.totalPages <= 1
          ? []
          : [
              listNavRow(
                userId,
                poolKey,
                groupKey,
                outcome.page,
                outcome.totalPages,
              ),
            ];
      const body = {
        embeds: [
          buildListEmbed({
            viewerId: userId,
            cards: outcome.cards,
            totalCards: outcome.totalCards,
            page: outcome.page,
            totalPages: outcome.totalPages,
            poolName: outcome.poolName,
            poolEmoji: outcome.poolEmoji,
            groupName: outcome.groupName,
            groupBadge: outcome.groupBadge,
            filters,
          }),
        ],
        components: nav,
      };
      await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
        ...body,
        ...(isPublic ? {} : { flags: 64 as const }),
      });
      return;
    }
  }
}

export function handleList(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  if (userId === null) {
    return ephemeralResponse("Tidak bisa membaca identitasmu.");
  }
  const poolId = stringOption(interaction, "pool");
  const groupId = stringOption(interaction, "grup");
  const isPublic = publicOption(interaction);
  const filters: ListFilters = { poolId, groupId };

  waitUntil(
    (async () => {
      try {
        await followupListPage(
          env,
          interaction.application_id,
          interaction.token,
          userId,
          filters,
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

export function handleListPage(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const target = parseListPageCustomId(interaction.data.custom_id);
  if (target === null) {
    return ephemeralResponse("Tombol kedaluwarsa.");
  }
  const clicker = invokerId(interaction);
  if (!isListButtonOwner(clicker, target.ownerId)) {
    return ephemeralResponse(`Tombol ini milik <@${target.ownerId}>.`);
  }
  const { ownerId, poolKey, groupKey, page } = target;
  const filters: ListFilters = {
    poolId: poolKey === "*" ? null : poolKey,
    groupId: groupKey === "*" ? null : groupKey,
  };

  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const outcome = await getListPage(db, filters, page);
        if (outcome.status !== "ok") {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              content:
                outcome.status === "empty"
                  ? "Belum ada kartu yang tersedia di cakupan ini."
                  : "Cakupan daftar kartu tidak tersedia lagi.",
              embeds: [],
              components: [],
            },
          );
          return;
        }
        const nav =
          outcome.totalPages <= 1
            ? []
            : [
                listNavRow(
                  ownerId,
                  poolKey,
                  groupKey,
                  outcome.page,
                  outcome.totalPages,
                ),
              ];
        await patchOriginal(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            embeds: [
              buildListEmbed({
                viewerId: ownerId,
                cards: outcome.cards,
                totalCards: outcome.totalCards,
                page: outcome.page,
                totalPages: outcome.totalPages,
                poolName: outcome.poolName,
                poolEmoji: outcome.poolEmoji,
                groupName: outcome.groupName,
                groupBadge: outcome.groupBadge,
                filters,
              }),
            ],
            components: nav,
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

export async function handleListAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: number;
    value?: string | number | boolean;
    focused?: boolean;
  }[];

  let focusedName: string | null = null;
  let focusedValue = "";
  let poolValue: string | null = null;

  for (const opt of options) {
    if (opt.name === "pool" && typeof opt.value === "string") {
      poolValue = opt.value;
    }
    if (opt.focused === true) {
      focusedName = opt.name;
      focusedValue = typeof opt.value === "string" ? opt.value : "";
    }
  }

  try {
    const db = createDb(env);
    if (focusedName === "pool") {
      const rows = await searchListPools(db, focusedValue);
      return {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: rows.map((r) => ({
            name: `${r.emoji} ${r.name}`.trim().slice(0, 100),
            value: r.id,
          })),
        },
      };
    }
    if (focusedName === "grup") {
      const rows = await searchListGroups(db, poolValue, focusedValue);
      const hasPoolFilter = poolValue !== null && poolValue.trim() !== "";
      return {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: rows.map((r) => ({
            name: (hasPoolFilter ? r.name : `${r.name} (${r.poolId})`).slice(
              0,
              100,
            ),
            value: r.id,
          })),
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
