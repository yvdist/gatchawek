import {
  InteractionResponseType,
  type APIInteraction,
  type APIInteractionResponse,
  type RESTPostAPIWebhookWithTokenJSONBody,
} from "discord-api-types/v10";

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
