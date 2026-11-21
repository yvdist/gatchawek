import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InteractionResponseType,
  InteractionType,
} from "discord-api-types/v10";
import { app } from "../src/index.js";
import {
  maintenanceMessage,
  maintenanceUntil,
  wibClock,
} from "../src/domain/maintenance.js";

const TIMESTAMP = "1700000000";
const UNTIL = "2026-11-22T00:05:00Z";

let publicKeyHex = "";
let signBody: (body: string) => string = () => "";

function discordHeaders(signature: string, timestamp: string): HeadersInit {
  return {
    "X-Signature-Ed25519": signature,
    "X-Signature-Timestamp": timestamp,
    "Content-Type": "application/json",
  };
}

/** Any DB access during the window throws, so a read would fail the test. */
function maintenanceEnv(): Record<string, unknown> {
  return {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    MAINTENANCE_UNTIL: UNTIL,
    DB: {
      prepare: () => {
        throw new Error("DB must not be touched during maintenance");
      },
    },
  };
}

async function postSigned(body: string, env: Record<string, unknown>) {
  return app.request(
    "/interactions",
    {
      method: "POST",
      headers: discordHeaders(signBody(body), TIMESTAMP),
      body,
    },
    env as Parameters<typeof app.request>[2],
  );
}

describe("maintenance window", () => {
  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ type: "spki", format: "der" });
    publicKeyHex = Buffer.from(publicDer.subarray(-32)).toString("hex");
    signBody = (body: string) =>
      sign(null, Buffer.from(TIMESTAMP + body), privateKey).toString("hex");
  });

  it("expires on its own instead of needing a redeploy", () => {
    const until = Date.parse(UNTIL);
    expect(maintenanceUntil(UNTIL, until - 1)).toBe(until);
    expect(maintenanceUntil(UNTIL, until)).toBeNull();
    expect(maintenanceUntil(UNTIL, until + 60_000)).toBeNull();
  });

  it("ignores an unset or unparseable window", () => {
    expect(maintenanceUntil(undefined, 0)).toBeNull();
    expect(maintenanceUntil("", 0)).toBeNull();
    expect(maintenanceUntil("besok pagi", 0)).toBeNull();
  });

  it("labels the end of the window in WIB", () => {
    expect(wibClock(Date.parse(UNTIL))).toBe("07:05 WIB");
  });

  it("answers a slash command without reading the database", async () => {
    const body = JSON.stringify({
      type: InteractionType.ApplicationCommand,
      application_id: "app",
      token: "tok",
      member: { user: { id: "u1" } },
      data: { name: "gacha", options: [] },
    });
    const res = await postSigned(body, maintenanceEnv());

    expect(res.status).toBe(200);
    const reply = (await res.json()) as {
      type: number;
      data: { content: string; flags: number };
    };
    expect(reply.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(reply.data.content).toBe(maintenanceMessage(Date.parse(UNTIL)));
    expect(reply.data.content).toContain("07:05 WIB");
    expect(reply.data.flags).toBe(64);
  });

  it("answers a button press with the same notice", async () => {
    const body = JSON.stringify({
      type: InteractionType.MessageComponent,
      application_id: "app",
      token: "tok",
      member: { user: { id: "u1" } },
      data: { custom_id: "gacha:again:u1:ahli-ngebul:1", component_type: 2 },
    });
    const res = await postSigned(body, maintenanceEnv());

    expect(res.status).toBe(200);
    const reply = (await res.json()) as { data: { content: string } };
    expect(reply.data.content).toContain("maintenance");
  });

  it("keeps autocomplete empty rather than erroring", async () => {
    const body = JSON.stringify({
      type: InteractionType.ApplicationCommandAutocomplete,
      application_id: "app",
      token: "tok",
      member: { user: { id: "u1" } },
      data: { name: "gacha", options: [] },
    });
    const res = await postSigned(body, maintenanceEnv());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    });
  });

  it("still answers PING so the Discord endpoint stays verified", async () => {
    const body = JSON.stringify({ type: InteractionType.Ping });
    const res = await postSigned(body, maintenanceEnv());

    expect(await res.json()).toEqual({ type: InteractionResponseType.Pong });
  });

  it("serves the admin maintenance page without a database read", async () => {
    const res = await app.request(
      "/admin/cards",
      {},
      maintenanceEnv() as Parameters<typeof app.request>[2],
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Maintenance database");
    expect(html).toContain("07:05 WIB");
  });
});
