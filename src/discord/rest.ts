import {
  InteractionResponseType,
  type APIGuildMember,
  type APIInteraction,
  type APIInteractionResponse,
  type APIUser,
  type RESTPostAPIWebhookWithTokenJSONBody,
} from "discord-api-types/v10";

export interface DiscordUserProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string;
}

function defaultAvatarIndex(
  userId: string,
  discriminator: string | null | undefined,
): number {
  if (
    typeof discriminator === "string" &&
    discriminator !== "" &&
    discriminator !== "0" &&
    /^\d+$/.test(discriminator)
  ) {
    return Number(discriminator) % 5;
  }
  if (/^\d+$/.test(userId)) {
    return Number((BigInt(userId) >> 22n) % 6n);
  }
  return 0;
}

export function buildDiscordAvatarUrl(args: {
  userId: string;
  userAvatar?: string | null | undefined;
  guildId?: string | null | undefined;
  memberAvatar?: string | null | undefined;
  discriminator?: string | null | undefined;
  size?: number | undefined;
}): string {
  const size = args.size ?? 256;
  if (
    typeof args.guildId === "string" &&
    args.guildId !== "" &&
    typeof args.memberAvatar === "string" &&
    args.memberAvatar !== ""
  ) {
    return `https://cdn.discordapp.com/guilds/${args.guildId}/users/${args.userId}/avatars/${args.memberAvatar}.png?size=${size}`;
  }
  if (typeof args.userAvatar === "string" && args.userAvatar !== "") {
    return `https://cdn.discordapp.com/avatars/${args.userId}/${args.userAvatar}.png?size=${size}`;
  }
  const index = defaultAvatarIndex(args.userId, args.discriminator);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function pickUserDisplayName(
  nick: string | null | undefined,
  globalName: string | null | undefined,
  username: string | null | undefined,
  fallbackId: string,
): string {
  if (typeof nick === "string" && nick.trim() !== "") return nick.trim();
  if (typeof globalName === "string" && globalName.trim() !== "") {
    return globalName.trim();
  }
  if (typeof username === "string" && username.trim() !== "") {
    return username.trim();
  }
  return `<@${fallbackId}>`;
}

export function extractInteractionUserProfile(
  interaction: APIInteraction,
): DiscordUserProfile | null {
  const userId = invokerId(interaction);
  if (userId === null) return null;
  const member = "member" in interaction ? interaction.member : undefined;
  const user = member?.user ?? ("user" in interaction ? interaction.user : undefined);
  const guildId = "guild_id" in interaction ? interaction.guild_id : undefined;
  return {
    userId,
    displayName: pickUserDisplayName(
      member?.nick,
      user?.global_name,
      user?.username,
      userId,
    ),
    avatarUrl: buildDiscordAvatarUrl({
      userId,
      userAvatar: user?.avatar,
      guildId,
      memberAvatar: member?.avatar,
      discriminator: user?.discriminator,
    }),
  };
}

/**
 * Resolves a Discord user's display name and avatar URL.
 * Fast-paths from the interaction payload when the target user is the invoker;
 * otherwise fetches guild member or user metadata via Discord REST API with a
 * non-throwing fallback.
 */
export async function resolveDiscordUserProfile(args: {
  userId: string;
  guildId?: string | null | undefined;
  botToken: string;
  interaction?: APIInteraction | undefined;
}): Promise<DiscordUserProfile> {
  if (args.interaction !== undefined && invokerId(args.interaction) === args.userId) {
    const direct = extractInteractionUserProfile(args.interaction);
    if (direct !== null) return direct;
  }

  const headers = { Authorization: `Bot ${args.botToken}` };

  if (typeof args.guildId === "string" && args.guildId !== "") {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/guilds/${args.guildId}/members/${args.userId}`,
        { headers },
      );
      if (res.ok) {
        const member = (await res.json()) as APIGuildMember;
        const user = member.user;
        return {
          userId: args.userId,
          displayName: pickUserDisplayName(
            member.nick,
            user?.global_name,
            user?.username,
            args.userId,
          ),
          avatarUrl: buildDiscordAvatarUrl({
            userId: args.userId,
            userAvatar: user?.avatar,
            guildId: args.guildId,
            memberAvatar: member.avatar,
            discriminator: user?.discriminator,
          }),
        };
      }
    } catch {
      // Fall through to global user lookup.
    }
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${args.userId}`, {
      headers,
    });
    if (res.ok) {
      const user = (await res.json()) as APIUser;
      return {
        userId: args.userId,
        displayName: pickUserDisplayName(
          null,
          user.global_name,
          user.username,
          args.userId,
        ),
        avatarUrl: buildDiscordAvatarUrl({
          userId: args.userId,
          userAvatar: user.avatar,
          discriminator: user.discriminator,
        }),
      };
    }
  } catch {
    // Fall through to deterministic fallback.
  }

  return {
    userId: args.userId,
    displayName: `<@${args.userId}>`,
    avatarUrl: buildDiscordAvatarUrl({ userId: args.userId }),
  };
}

/** Deferred response for slash commands; real content follows via webhook. */
export function deferredResponse(): APIInteractionResponse {
  return { type: InteractionResponseType.DeferredChannelMessageWithSource };
}



export function ephemeralResponse(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: 64 },
  };
}

export function invokerId(i: APIInteraction): string | null {
  if ("member" in i && i.member?.user?.id !== undefined) {
    return i.member.user.id;
  }
  if ("user" in i && i.user?.id !== undefined) return i.user.id;
  return null;
}

function webhookBase(appId: string, token: string): string {
  return `https://discord.com/api/v10/webhooks/${appId}/${token}`;
}

function mentionless(
  body: RESTPostAPIWebhookWithTokenJSONBody,
): RESTPostAPIWebhookWithTokenJSONBody {
  return { ...body, allowed_mentions: { parse: [] } };
}

export async function postFollowup(
  appId: string,
  token: string,
  botToken: string,
  body: RESTPostAPIWebhookWithTokenJSONBody,
): Promise<void> {
  const res = await fetch(`${webhookBase(appId, token)}?wait=true`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mentionless(body)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`followup failed: ${res.status} ${text}`.trim());
  }
}

export async function postFollowupFile(
  appId: string,
  token: string,
  botToken: string,
  file: {
    readonly filename: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  },
  body: RESTPostAPIWebhookWithTokenJSONBody = {},
): Promise<void> {
  const payload = {
    ...mentionless(body),
    attachments: [{ id: 0, filename: file.filename }],
  };
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  const copy = new Uint8Array(file.bytes.byteLength);
  copy.set(file.bytes);
  form.append(
    "files[0]",
    new Blob([copy], { type: file.contentType }),
    file.filename,
  );
  const res = await fetch(`${webhookBase(appId, token)}?wait=true`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`followup file failed: ${res.status} ${text}`.trim());
  }
}

export async function patchOriginal(
  appId: string,
  token: string,
  botToken: string,
  body: RESTPostAPIWebhookWithTokenJSONBody,
): Promise<void> {
  const res = await fetch(`${webhookBase(appId, token)}/messages/@original`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mentionless(body)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`patch original failed: ${res.status} ${text}`.trim());
  }
}
