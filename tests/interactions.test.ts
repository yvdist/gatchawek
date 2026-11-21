import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InteractionResponseType,
  InteractionType,
} from "discord-api-types/v10";
import { app } from "../src/index.js";

const TIMESTAMP = "1700000000";

let publicKeyHex = "";
let signBody: (body: string) => string = () => "";

function discordHeaders(signature: string, timestamp: string): HeadersInit {
  return {
    "X-Signature-Ed25519": signature,
    "X-Signature-Timestamp": timestamp,
    "Content-Type": "application/json",
  };
}

describe("POST /interactions signature verification", () => {
  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ type: "spki", format: "der" });
    // SPKI DER header for Ed25519 is 12 bytes; last 32 bytes are the raw key.
    publicKeyHex = Buffer.from(publicDer.subarray(-32)).toString("hex");
    signBody = (body: string) =>
      sign(null, Buffer.from(TIMESTAMP + body), privateKey).toString("hex");
  });

  it("replies Pong to a valid PING", async () => {
    const body = JSON.stringify({ type: InteractionType.Ping });
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: InteractionResponseType.Pong });
  });

  it("rejects a request with a missing signature header", async () => {
    const body = JSON.stringify({ type: InteractionType.Ping });
    const res = await app.request("/interactions", {
      method: "POST",
      headers: {
        "X-Signature-Timestamp": TIMESTAMP,
        "Content-Type": "application/json",
      },
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Bad request signature");
  });

  it("rejects a body altered by one byte after signing", async () => {
    const original = JSON.stringify({ type: InteractionType.Ping });
    const signature = signBody(original);
    const tampered = ` ${original.slice(1)}`;
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signature, TIMESTAMP),
      body: tampered,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Bad request signature");
  });

  it("serves GET /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("dispatches /ping to the ping handler", async () => {
    const body = JSON.stringify({
      type: InteractionType.ApplicationCommand,
      id: "1",
      application_id: "2",
      token: "token",
      version: 1,
      data: { id: "3", name: "ping", type: 1 },
    });
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(200);
    const payload: unknown = await res.json();
    expect(payload).toMatchObject({ data: { content: expect.stringContaining("Pong") } });
  });

  it("returns 400 Bad request for a signed malformed JSON body", async () => {
    const body = "{not-json";
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bad request");
  });

  it("returns 400 Unknown command for an unregistered slash name", async () => {
    const body = JSON.stringify({
      type: InteractionType.ApplicationCommand,
      id: "1",
      application_id: "2",
      token: "token",
      version: 1,
      data: { id: "3", name: "kartu", type: 1 },
    });
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown command" });
  });

  it("returns 400 for an unhandled interaction type", async () => {
    const body = JSON.stringify({ type: 99 });
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unhandled interaction type" });
  });

  it("answers unknown component namespace with an expired-button message", async () => {
    const body = JSON.stringify({
      type: InteractionType.MessageComponent,
      id: "1",
      application_id: "2",
      token: "token",
      version: 1,
      data: { component_type: 2, custom_id: "nope:zzz" },
      message: { id: "m", type: 20, flags: 0 },
      member: { user: { id: "u1", username: "u", discriminator: "0" } },
    });
    const res = await app.request("/interactions", {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    }, { DISCORD_PUBLIC_KEY: publicKeyHex });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data?: { content?: string } };
    expect(payload.data?.content).toContain("kedaluwarsa");
  });
});
