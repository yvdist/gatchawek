import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMIN_SESSION_COOKIE, signSession } from "../src/admin/auth.js";
import { registerAdminRoutes } from "../src/admin/routes.js";
import { createDb } from "../src/db/client.js";
import { getAdminCard } from "../src/db/queries/admin.js";
import { cards, groups, injectQueue, pools } from "../src/db/schema.js";
import type { Env } from "../src/env.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let mf: Miniflare;
let env: Env;
let app: Hono<{ Bindings: Env }>;
let authCookie: string;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  const d1 = await mf.getD1Database("DB");
  const dir = path.join(REPO_ROOT, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const content = await readFile(path.join(dir, file), "utf8");
    for (const chunk of content.split("--> statement-breakpoint")) {
      const stmt = chunk
        .trim()
        .replace(/`/g, '"')
        .replace(/;$/, "")
        .replace(/\s+/g, " ");
      if (stmt !== "") await d1.exec(stmt);
    }
  }
  env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: d1,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
    INGEST_CHANNEL_ID: "c-ingest",
    INGEST_GUILD_ID: "g-ingest",
    INJECT_APPROVER_IDS: "boss",
    ADMIN_PASSWORD: "secret",
    ADMIN_SECRET: "hmac-secret",
  };
  const db = createDb(env);
  await db.insert(pools).values({
    id: "ahli-ngebul",
    name: "Ahli Ngebul",
    emoji: "💨",
    staminaMax: 10,
    regenIntervalSec: 100,
    resetCooldownSec: 3600,
    memberCount: 0,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "default",
    poolId: "ahli-ngebul",
    name: "Default",
    badge: "NGEBUL",
    memberCount: 0,
    enabled: true,
  });
  await db.insert(pools).values({
    id: "pejabat",
    name: "Pejabat",
    emoji: "🏛️",
    staminaMax: 10,
    regenIntervalSec: 100,
    resetCooldownSec: 3600,
    memberCount: 0,
    enabled: true,
  });
  await db.insert(groups).values({
    id: "kabinet",
    poolId: "pejabat",
    name: "Kabinet",
    badge: "KAB",
    memberCount: 0,
    enabled: true,
  });

  app = new Hono<{ Bindings: Env }>();
  registerAdminRoutes(app);

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signSession(env.ADMIN_SECRET, nowSec + 3600);
  authCookie = `${ADMIN_SESSION_COOKIE}=${token}`;
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("admin /admin/import routes", () => {
  it("requires authentication on GET and POST /admin/import", async () => {
    const getRes = await app.request("/admin/import", {}, env);
    expect(getRes.status).toBe(302);
    const postRes = await app.request("/admin/import", { method: "POST" }, env);
    expect(postRes.status).toBe(401);
  });

  it("renders GET /admin/import with active pool groups", async () => {
    const res = await app.request(
      "/admin/import",
      { headers: { Cookie: authCookie } },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="ahli-ngebul:default"');
    expect(html).toContain("(holo) - refi kaget.jpg");
    expect(html).toContain("★★★★★ Holo");
  });

  it("uploads via Discord CDN and creates a 5-star holo card from filename template", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "m1",
          channel_id: "c-ingest",
          attachments: [
            { url: "https://cdn.discordapp.com/attachments/1/2/refi-kaget.jpg" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fd = new FormData();
      fd.set("poolGroup", "ahli-ngebul:default");
      fd.set(
        "files",
        new File([new Uint8Array([1, 2, 3, 4])], "(holo) - refi kaget.jpg", {
          type: "image/jpeg",
        }),
      );
      const res = await app.request(
        "/admin/import",
        {
          method: "POST",
          headers: {
            Cookie: authCookie,
            Accept: "application/json",
          },
          body: fd,
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        results: Array<{ filename: string; ok: boolean; cardId?: string; message: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]?.cardId).toBe("refi-kaget-01");

      const detail = await getAdminCard(createDb(env), "refi-kaget-01");
      expect(detail).toMatchObject({
        memberName: "Refi Kaget",
        rarity: "holo",
        holoEnabled: true,
        imageFile: "https://cdn.discordapp.com/attachments/1/2/refi-kaget.jpg",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes a 3-segment secret filename into its own group and keeps audit messageUrl", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "m2",
          channel_id: "c-ingest",
          attachments: [
            { url: "https://cdn.discordapp.com/attachments/1/2/x.jpg" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fd = new FormData();
      fd.set("poolGroup", "pejabat:kabinet");
      fd.set(
        "files",
        new File([new Uint8Array([9, 9, 9])], "(secret) - Default - X.jpg", {
          type: "image/jpeg",
        }),
      );
      const res = await app.request(
        "/admin/import",
        {
          method: "POST",
          headers: {
            Cookie: authCookie,
            Accept: "application/json",
          },
          body: fd,
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        results: Array<{ filename: string; ok: boolean; cardId?: string; message: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]?.cardId).toBe("x-01");

      const db = createDb(env);
      const [row] = await db.select().from(cards).where(eq(cards.id, "x-01")).limit(1);
      expect(row?.rarity).toBe("secret");
      expect(row?.poolId).toBe("ahli-ngebul");
      expect(row?.groupId).toBe("default");
      const [audit] = await db
        .select()
        .from(injectQueue)
        .where(eq(injectQueue.memberId, "x"))
        .limit(1);
      expect(audit?.messageUrl).toBe("https://discord.com/channels/g-ingest/c-ingest/m2");
      expect(audit?.sumber).toBe("https://cdn.discordapp.com/attachments/1/2/x.jpg");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes a cross-pool group name to the other pool and auto-creates unknown groups", async () => {
    let discordCalls = 0;
    const fetchMock = vi.fn(async () => {
      discordCalls += 1;
      return new Response(
        JSON.stringify({
          id: `m-cross-${String(discordCalls)}`,
          channel_id: "c-ingest",
          attachments: [
            { url: `https://cdn.discordapp.com/attachments/1/2/cross-${String(discordCalls)}.jpg` },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fd = new FormData();
      fd.set("poolGroup", "ahli-ngebul:default");
      fd.append(
        "files",
        new File([new Uint8Array([5])], "(rare) - Kabinet - Cross Kid.jpg", {
          type: "image/jpeg",
        }),
      );
      fd.append(
        "files",
        new File([new Uint8Array([6])], "(common) - Atlantis - Lost Kid.jpg", {
          type: "image/jpeg",
        }),
      );
      fd.append(
        "files",
        new File([new Uint8Array([7])], "(common) - batch kid.jpg", {
          type: "image/jpeg",
        }),
      );
      const res = await app.request(
        "/admin/import",
        {
          method: "POST",
          headers: {
            Cookie: authCookie,
            Accept: "application/json",
          },
          body: fd,
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        results: Array<{ filename: string; ok: boolean; cardId?: string; message: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(3);
      expect(body.results[0]).toMatchObject({ ok: true, cardId: "cross-kid-01" });
      expect(body.results[1]).toMatchObject({ ok: true, cardId: "lost-kid-01" });
      expect(body.results[1]?.message).toContain("grup baru Atlantis");
      expect(body.results[2]).toMatchObject({ ok: true, cardId: "batch-kid-01" });

      const db = createDb(env);
      const [cross] = await db.select().from(cards).where(eq(cards.id, "cross-kid-01")).limit(1);
      expect(cross?.poolId).toBe("pejabat");
      expect(cross?.groupId).toBe("kabinet");
      const [lost] = await db.select().from(cards).where(eq(cards.id, "lost-kid-01")).limit(1);
      expect(lost?.poolId).toBe("ahli-ngebul");
      expect(lost?.groupId).toBe("atlantis");
      const [atlantis] = await db.select().from(groups).where(eq(groups.id, "atlantis")).limit(1);
      expect(atlantis).toMatchObject({ poolId: "ahli-ngebul", name: "Atlantis", enabled: true });
      const [batch] = await db.select().from(cards).where(eq(cards.id, "batch-kid-01")).limit(1);
      expect(batch?.poolId).toBe("ahli-ngebul");
      expect(batch?.groupId).toBe("default");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates a new group once when two files share it", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "m-ramean",
          channel_id: "c-ingest",
          attachments: [
            { url: "https://cdn.discordapp.com/attachments/1/2/ramean.jpg" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fd = new FormData();
      fd.set("poolGroup", "ahli-ngebul:default");
      fd.append(
        "files",
        new File(
          [new Uint8Array([11])],
          "(super_rare) - Ramean - Salman Habibi.jpg",
          { type: "image/jpeg" },
        ),
      );
      fd.append(
        "files",
        new File(
          [new Uint8Array([12])],
          "(secret) - Ramean - Jidan Kedua.jpg",
          { type: "image/jpeg" },
        ),
      );
      const res = await app.request(
        "/admin/import",
        {
          method: "POST",
          headers: {
            Cookie: authCookie,
            Accept: "application/json",
          },
          body: fd,
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        results: Array<{ filename: string; ok: boolean; cardId?: string; message: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(2);
      expect(body.results[0]).toMatchObject({ ok: true });
      expect(body.results[0]?.message).toContain("grup baru Ramean");
      expect(body.results[1]).toMatchObject({ ok: true });
      expect(body.results[1]?.message).not.toContain("grup baru");

      const db = createDb(env);
      const ramean = await db.select().from(groups).where(eq(groups.id, "ramean"));
      expect(ramean).toHaveLength(1);
      expect(ramean[0]).toMatchObject({
        poolId: "ahli-ngebul",
        name: "Ramean",
        badge: "RAMEAN",
        memberCount: 2,
      });
      const [first] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, "salman-habibi-01"))
        .limit(1);
      expect(first?.groupId).toBe("ramean");
      const [second] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, "jidan-kedua-01"))
        .limit(1);
      expect(second?.groupId).toBe("ramean");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a symbol-only group segment as ambiguous", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("upload must not run for rejected files");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fd = new FormData();
      fd.set("poolGroup", "ahli-ngebul:default");
      fd.set(
        "files",
        new File([new Uint8Array([13])], "(rare) - @#$% - Simbol Kid.jpg", {
          type: "image/jpeg",
        }),
      );
      const res = await app.request(
        "/admin/import",
        {
          method: "POST",
          headers: {
            Cookie: authCookie,
            Accept: "application/json",
          },
          body: fd,
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        results: Array<{ filename: string; ok: boolean; cardId?: string; message: string }>;
      };
      expect(body.ok).toBe(false);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({ ok: false });
      expect(body.results[0]?.message).toContain("ambigu");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a slug collision with a different group name", async () => {
    const db = createDb(env);
    await db.insert(groups).values({
      id: "tabrakan",
      poolId: "ahli-ngebul",
      name: "Tabrakan X",
      badge: "TBRX",
      memberCount: 0,
      enabled: true,
    });
    const fetchMock = vi.fn(async () => {
      throw new Error("upload must not run for rejected files");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const fd = new FormData();
      fd.set("poolGroup", "ahli-ngebul:default");
      fd.set(
        "files",
        new File([new Uint8Array([14])], "(rare) - Tabrakan! - Tabrakan Kid.jpg", {
          type: "image/jpeg",
        }),
      );
      const res = await app.request(
        "/admin/import",
        {
          method: "POST",
          headers: {
            Cookie: authCookie,
            Accept: "application/json",
          },
          body: fd,
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        results: Array<{ filename: string; ok: boolean; cardId?: string; message: string }>;
      };
      expect(body.ok).toBe(false);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({ ok: false });
      expect(body.results[0]?.message).toContain("ambigu");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
