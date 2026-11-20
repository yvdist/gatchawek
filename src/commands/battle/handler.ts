import {
  ApplicationCommandOptionType,
  ComponentType,
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
  canActOnBattle,
  parseBattleCustomId,
  parseBattleMode,
  type BattleMode,
  type BattleValidationError,
} from "../../domain/battle.js";
import {
  createBattle,
  getBattleById,
  listTargetBattleCards,
  resolveBattleCancelOrDecline,
  settleBattle,
} from "../../db/queries/battle.js";
import { searchShowcaseCards } from "../../db/queries/pamer.js";
import {
  battlePendingComponents,
  buildBattleClosedEmbed,
  buildBattlePendingEmbed,
  buildBattleResolvedEmbed,
} from "../../ui/battleEmbed.js";
import { cryptoRandom } from "../pamer/handler.js";
import type { WaitUntil } from "../registry.js";

function optionValue(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const options = interaction.data.options ?? [];
  for (const opt of options) {
    if (
      opt.name === name &&
      (opt.type === ApplicationCommandOptionType.User ||
        opt.type === ApplicationCommandOptionType.String) &&
      typeof opt.value === "string"
    ) {
      return opt.value;
    }
  }
  return null;
}

function friendlyReject(reason: BattleValidationError): string {
  switch (reason) {
    case "self-battle":
      return "Tidak bisa battle dengan diri sendiri.";
    case "bot-target":
      return "Tidak bisa menantang bot.";
    case "card-not-owned":
      return "Kamu tidak punya kartu itu.";
    case "card-disabled":
      return "Kartu itu sudah tidak tersedia.";
    case "target-has-no-cards":
      return "Lawan belum punya kartu aktif untuk diajak battle.";
    case "pending-limit":
      return "Kamu sudah punya 3 tantangan battle pending. Selesaikan dulu.";
  }
}

export function handleBattle(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const challengerId = invokerId(interaction);
  const targetId = optionValue(interaction, "user");
  const cardId = optionValue(interaction, "card");
  const mode = parseBattleMode(optionValue(interaction, "mode"));
  if (challengerId === null || targetId === null || cardId === null) {
    return ephemeralResponse("Opsi battle tidak lengkap. Coba lagi.");
  }
  if (challengerId === targetId) {
    return ephemeralResponse(friendlyReject("self-battle"));
  }
  const targetIsBot =
    interaction.data.resolved?.users?.[targetId]?.bot === true;
  if (targetIsBot || targetId === interaction.application_id) {
    return ephemeralResponse(friendlyReject("bot-target"));
  }

  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const now = Math.floor(Date.now() / 1000);
        const outcome = await createBattle(db, {
          challengerId,
          targetId,
          targetIsBot,
          challengerCardId: cardId,
          mode,
          now,
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
        const targetChoices = await listTargetBattleCards(db, targetId);
        if (targetChoices.length === 0) {
          await resolveBattleCancelOrDecline(
            db,
            outcome.battleId,
            "cancelled",
            now,
          ).catch(() => false);
          await postFollowup(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: friendlyReject("target-has-no-cards"), flags: 64 },
          );
          return;
        }
        await postFollowup(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            embeds: [
              buildBattlePendingEmbed({
                challengerId,
                targetId,
                challengerRarity: outcome.challengerRarity,
                mode,
                expiresAt: outcome.expiresAt,
              }),
            ],
            components: battlePendingComponents(outcome.battleId, targetChoices),
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

export async function handleBattleComponent(
  interaction: APIMessageComponentInteraction,
  env: Env,
  waitUntil: WaitUntil,
  rand: () => number = cryptoRandom,
): Promise<APIInteractionResponse> {
  const customId =
    "custom_id" in interaction.data ? interaction.data.custom_id : "";
  const parsed = parseBattleCustomId(customId);
  if (parsed === null) return ephemeralResponse("Komponen kedaluwarsa.");

  const actorId = invokerId(interaction);
  if (actorId === null) {
    return ephemeralResponse("Tidak bisa membaca identitasmu.");
  }

  let selectedCardId: string | null = null;
  if (parsed.action === "pick") {
    if (interaction.data.component_type !== ComponentType.StringSelect) {
      return ephemeralResponse("Komponen tidak valid.");
    }
    const val = interaction.data.values[0];
    if (val === undefined || val === "") {
      return ephemeralResponse("Pilihan kartu tidak terbaca.");
    }
    selectedCardId = val;
  }

  let gateRow: Awaited<ReturnType<typeof getBattleById>>;
  try {
    gateRow = await getBattleById(createDb(env), parsed.battleId);
  } catch {
    return ephemeralResponse("D1 sibuk/kuota habis, coba lagi.");
  }
  if (gateRow === null) return ephemeralResponse("Tantangan tidak ditemukan.");
  if (gateRow.status !== "pending") {
    return ephemeralResponse("Tantangan ini sudah selesai diproses.");
  }
  if (
    !canActOnBattle(
      parsed.action,
      actorId,
      gateRow.challengerId,
      gateRow.targetId,
    )
  ) {
    return ephemeralResponse("Interaksi ini bukan untukmu.");
  }

  waitUntil(
    (async () => {
      try {
        const db = createDb(env);
        const now = Math.floor(Date.now() / 1000);
        if (parsed.action === "pick" && selectedCardId !== null) {
          const outcome = await settleBattle(db, {
            battleId: parsed.battleId,
            targetCardId: selectedCardId,
            now,
            rand,
          });
          if (outcome.status === "not-found") {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Tantangan tidak ditemukan.", components: [] },
            );
            return;
          }
          if (outcome.status === "already-resolved") {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              { content: "Tantangan ini sudah selesai diproses.", components: [] },
            );
            return;
          }
          if (
            outcome.status === "expired" ||
            outcome.status === "ownership-changed"
          ) {
            await patchOriginal(
              interaction.application_id,
              interaction.token,
              env.DISCORD_BOT_TOKEN,
              {
                embeds: [
                  buildBattleClosedEmbed({
                    challengerId: gateRow.challengerId,
                    targetId: gateRow.targetId,
                    mode: gateRow.mode as BattleMode,
                    status:
                      outcome.status === "expired" ? "expired" : "failed",
                  }),
                ],
                components: [],
              },
            );
            return;
          }
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            {
              embeds: [
                buildBattleResolvedEmbed({
                  challengerId: gateRow.challengerId,
                  targetId: gateRow.targetId,
                  challengerCard: outcome.challengerCard,
                  targetCard: outcome.targetCard,
                  calc: outcome.calc,
                  mode: outcome.mode,
                  winnerStats: outcome.winnerStats,
                  baseUrl: env.PUBLIC_BASE_URL,
                }),
              ],
              components: [],
            },
          );
          return;
        }

        const row = await getBattleById(db, parsed.battleId);
        if (row === null || row.status !== "pending") {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Tantangan ini sudah selesai diproses.", components: [] },
          );
          return;
        }
        const finalStatus =
          row.expiresAt <= now
            ? ("expired" as const)
            : parsed.action === "decline"
              ? ("declined" as const)
              : ("cancelled" as const);
        const dbStatus = finalStatus === "declined" ? "declined" : "cancelled";
        const updated = await resolveBattleCancelOrDecline(
          db,
          parsed.battleId,
          dbStatus,
          now,
        );
        if (!updated) {
          await patchOriginal(
            interaction.application_id,
            interaction.token,
            env.DISCORD_BOT_TOKEN,
            { content: "Tantangan ini sudah selesai diproses.", components: [] },
          );
          return;
        }
        await patchOriginal(
          interaction.application_id,
          interaction.token,
          env.DISCORD_BOT_TOKEN,
          {
            embeds: [
              buildBattleClosedEmbed({
                challengerId: row.challengerId,
                targetId: row.targetId,
                mode: row.mode as BattleMode,
                status: finalStatus,
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

export async function handleBattleAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: number;
    value?: string | number | boolean;
    focused?: boolean;
  }[];
  let typed = "";
  let focusedName = "";
  for (const opt of options) {
    if (opt.focused === true) {
      focusedName = opt.name;
      if (typeof opt.value === "string") typed = opt.value;
    }
  }
  const ownerId = invokerId(interaction);
  if (ownerId === null || focusedName !== "card") {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
  try {
    const choices = await searchShowcaseCards(createDb(env), ownerId, typed);
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: {
        choices: choices.map((c) => ({ name: c.label, value: c.id })),
      },
    };
  } catch {
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    };
  }
}
