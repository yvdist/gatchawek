import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { createDb } from "../../db/client.js";
import { groups, members, pools } from "../../db/schema.js";
import { searchMembers } from "../../db/queries/cari.js";
import {
  buildCariEmbed,
  buildCariEmpty,
  CARI_MAX_MEMBERS,
} from "../../ui/cariEmbed.js";
import type { Env } from "../../env.js";
import {
  deferredResponse,
  ephemeralResponse,
  invokerId,
  patchOriginal,
  postFollowup,
} from "../../discord/rest.js";
import type { WaitUntil } from "../registry.js";

function stringOption(
  interaction: APIChatInputApplicationCommandInteraction,
  name: string,
): string | null {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: number;
    value?: string | number | boolean;
  }[];
  for (const opt of options) {
    if (opt.name === name && typeof opt.value === "string") return opt.value;
  }
  return null;
}

async function followupCari(
  env: Env,
  appId: string,
  token: string,
  query: string,
  poolId: string | null,
): Promise<void> {
  const db = createDb(env);
  const results = await searchMembers(db, query, poolId);
  if (results.length === 0) {
    await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
      embeds: [buildCariEmpty(query)],
    });
    return;
  }
  const truncated = Math.max(0, results.length - CARI_MAX_MEMBERS);
  // postFollowup forces allowed_mentions parse:[] (no pings); owner ids
  // still render as <@id> text per the holo-plan fallback.
  await postFollowup(appId, token, env.DISCORD_BOT_TOKEN, {
    embeds: [buildCariEmbed(results, query, truncated)],
  });
}

export function handleCari(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
): APIInteractionResponse {
  const userId = invokerId(interaction);
  const query = stringOption(interaction, "nama");
  if (userId === null || query === null || query.trim() === "") {
    return ephemeralResponse("Tulis nama karakter yang dicari.");
  }
  const poolRaw = stringOption(interaction, "pool");
  const poolId = poolRaw === null || poolRaw === "" ? null : poolRaw;
  waitUntil(
    (async () => {
      try {
        await followupCari(
          env,
          interaction.application_id,
          interaction.token,
          query,
          poolId,
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

export async function handleCariAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<APIInteractionResponse> {
  const options = (interaction.data.options ?? []) as {
    name: string;
    type: ApplicationCommandOptionType;
    value?: string | number | boolean;
    focused?: boolean;
  }[];
  let typed = "";
  for (const opt of options) {
    if (opt.name === "nama" && typeof opt.value === "string") typed = opt.value;
  }
  try {
    const db = createDb(env);
    const sanitized = typed.replace(/[%_\\]/g, "").toLowerCase();
    const rows = await db
      .select({
        name: members.name,
        groupName: groups.name,
        poolName: pools.name,
      })
      .from(members)
      .innerJoin(groups, eq(members.groupId, groups.id))
      .innerJoin(pools, eq(members.poolId, pools.id))
      .where(
        and(
          eq(members.enabled, true),
          sanitized === "" ? sql`1 = 1` : like(members.nameLower, `%${sanitized}%`),
        ),
      )
      .orderBy(asc(members.nameLower))
      .limit(25);
    return {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: {
        choices: rows.map((r) => ({
          name: `${r.name} (${r.groupName})`.slice(0, 100),
          value: r.name,
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
