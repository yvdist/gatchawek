import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { APIMessage } from "discord-api-types/v10";
import { ingest } from "../scripts/ingest.js";

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

const IMG = {
  id: "a1",
  url: "https://cdn.discordapp.net/attachments/1/2/foto.png",
  filename: "foto.png",
  content_type: "image/png",
  size: 100,
  proxy_url: "https://media.discordapp.net/attachments/1/2/foto.png",
  width: 600,
  height: 800,
};

function message(overrides: Partial<APIMessage> & { id: string }): APIMessage {
  return {
    channel_id: "222",
    content: "",
    timestamp: "2026-01-01T00:00:00.000Z",
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
    author: {
      id: "900",
      username: "kontributor",
      discriminator: "0",
      global_name: null,
      avatar: null,
      bot: false,
      system: false,
    },
    ...overrides,
  } as APIMessage;
}

const VALID_CONTENT = `[nama] Aynid Morbulet
[grup] komunitas-x
[rarity] rare`;

function mockFetch(messages: APIMessage[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(messages), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

async function readJson(root: string, ...parts: string[]): Promise<unknown> {
  return JSON.parse(await readFile(path.join(root, ...parts), "utf8"));
}

describe("ingest", () => {
  it("writes pending + rejected, skips bots, advances the cursor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gatchawek-ingest-"));
    roots.push(root);
    const pendingDir = path.join(root, "data", "submissions", "pending");
    const rejectedDir = path.join(root, "data", "submissions", "rejected");
    const stateFile = path.join(root, "data", "ingest-state.json");

    const messages = [
      message({ id: "10", content: VALID_CONTENT, attachments: [{ ...IMG }] }),
      message({ id: "11", content: "[nama] Tanpa Rarity" }),
      message({
        id: "12",
        content: VALID_CONTENT,
        attachments: [{ ...IMG, id: "a2" }],
        author: {
          id: "901",
          username: "bot",
          discriminator: "0",
          global_name: null,
          avatar: null,
          bot: true,
          system: false,
        },
      }),
    ];
    const fetchFn = vi.fn(mockFetch(messages));
    const result = await ingest(root, {
      env: {
        token: "TOKEN",
        channelId: "222",
        stateFile,
        pendingDir,
        rejectedDir,
      },
      fetchFn,
    });

    expect(result).toEqual({ valid: 1, invalid: 1, skipped: 1, cursor: "12" });
    expect(await readdir(pendingDir)).toEqual(["10.json"]);
    expect(await readdir(rejectedDir)).toEqual(["11.json"]);
    const pending = (await readJson(root, "data", "submissions", "pending", "10.json")) as {
      submission: { nama: string };
    };
    expect(pending.submission.nama).toBe("Aynid Morbulet");
    expect(await readJson(root, "data", "ingest-state.json")).toEqual({
      after: "12",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across runs and resumes from the cursor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gatchawek-ingest-"));
    roots.push(root);
    const pendingDir = path.join(root, "data", "submissions", "pending");
    const rejectedDir = path.join(root, "data", "submissions", "rejected");
    const stateFile = path.join(root, "data", "ingest-state.json");
    const env = { token: "T", channelId: "222", stateFile, pendingDir, rejectedDir };

    const batch1 = [message({ id: "20", content: VALID_CONTENT, attachments: [{ ...IMG }] })];
    await ingest(root, { env, fetchFn: mockFetch(batch1) });
    expect(await readdir(pendingDir)).toEqual(["20.json"]);

    // Same message again: no rewrite, cursor unchanged.
    const again = await ingest(root, { env, fetchFn: mockFetch(batch1) });
    expect(again).toEqual({ valid: 0, invalid: 0, skipped: 1, cursor: "20" });

    // New message: after=cursor filters server-side; here emulate it.
    await writeFile(stateFile, JSON.stringify({ after: "20" }));
    const batch2 = [
      message({ id: "20", content: VALID_CONTENT, attachments: [{ ...IMG }] }),
      message({ id: "21", content: VALID_CONTENT, attachments: [{ ...IMG, id: "a9" }] }),
    ];
    const seenUrls: string[] = [];
    const filtering = (async (input: unknown) => {
      const url = String(input);
      seenUrls.push(url);
      const after = new URL(url).searchParams.get("after");
      const filtered = batch2.filter((m) => after === null || m.id > after);
      return new Response(JSON.stringify(filtered), { status: 200 });
    }) as typeof fetch;
    const second = await ingest(root, { env, fetchFn: filtering });
    expect(second.valid).toBe(1);
    expect(seenUrls.some((u) => u.includes("after=20"))).toBe(true);
    expect(await readdir(pendingDir)).toEqual(["20.json", "21.json"]);
  });

  it("surfaces permission errors with an actionable message", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gatchawek-ingest-"));
    roots.push(root);
    const forbidden = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await expect(
      ingest(root, {
        env: {
          token: "T",
          channelId: "222",
          stateFile: path.join(root, "s.json"),
          pendingDir: path.join(root, "p"),
          rejectedDir: path.join(root, "r"),
        },
        fetchFn: forbidden,
      }),
    ).rejects.toThrow(/Read Message History/);
  });
});
