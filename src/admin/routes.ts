import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SEC,
  signSession,
  verifyPassword,
  verifySession,
} from "./auth.js";
import { createDb } from "../db/client.js";
import {
  ensureImportGroup,
  getAdminCard,
  getAdminCounts,
  importAdminCard,
  listAdminCards,
  listAdminPoolGroups,
  listAdminQueue,
  listRenderableCards,
  setAdminCardEnabled,
  setAdminCardImage,
  type AdminCardKindFilter,
  type AdminQueueStatus,
} from "../db/queries/admin.js";
import { approveQueued, rejectQueued } from "../db/queries/inject.js";
import {
  parseCardFilename,
  parseRarityAlias,
} from "../domain/cardImport.js";
import { planGroupForImport } from "../domain/importGroups.js";
import type { Env } from "../env.js";
import {
  cardDetailPage,
  cardsPage,
  dashboardPage,
  importPage,
  injectPage,
  loginPage,
  type ImportBatchItemResult,
} from "../ui/adminHtml.js";

const MAX_UPLOAD_BYTES = 8_000_000;
const MAX_MANUAL_URL_LEN = 500;
const MAX_LABEL_LEN = 60;

async function uploadImageToDiscord(
  env: Env,
  file: File,
  content: string,
): Promise<
  | { ok: true; url: string; messageId: string; messageUrl: string }
  | { ok: false; error: string }
> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "File harus gambar." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File melebihi 8 MB." };
  }
  const discord = new FormData();
  discord.set("content", content);
  discord.set("file", file, file.name || "upload");
  let res: Response;
  try {
    res = await fetch(
      `https://discord.com/api/v10/channels/${env.INGEST_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        body: discord,
      },
    );
  } catch {
    return {
      ok: false,
      error: "Upload ke Discord gagal (jaringan). D1 tidak diubah.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `Upload ke Discord gagal (${res.status}). D1 tidak diubah.`,
    };
  }
  let payload: {
    attachments?: { url?: string }[];
    id?: string;
    channel_id?: string;
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    return {
      ok: false,
      error: "Respons Discord tak terbaca. D1 tidak diubah.",
    };
  }
  const cdn = payload.attachments?.[0]?.url;
  if (typeof cdn !== "string" || cdn === "") {
    return {
      ok: false,
      error: "Discord tak mengembalikan URL. D1 tidak diubah.",
    };
  }
  const messageId = typeof payload.id === "string" ? payload.id : "";
  const channelId =
    typeof payload.channel_id === "string" && payload.channel_id !== ""
      ? payload.channel_id
      : env.INGEST_CHANNEL_ID;
  const messageUrl =
    messageId !== ""
      ? `https://discord.com/channels/${env.INGEST_GUILD_ID}/${channelId}/${messageId}`
      : cdn;
  return { ok: true, url: cdn, messageId, messageUrl };
}

// Single-user owner panel: cookie is HttpOnly + SameSite=Lax + Secure with
// POST-only mutations, proportional to this threat model (no CSRF token).

export function registerAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  const admin = new Hono<{ Bindings: Env }>();

  admin.use("*", async (c, next) => {
    if (c.req.path === "/admin/login") return next();
    const value = getCookie(c, ADMIN_SESSION_COOKIE);
    const nowSec = Math.floor(Date.now() / 1000);
    const ok =
      value !== undefined &&
      value !== "" &&
      (await verifySession(c.env.ADMIN_SECRET, value, nowSec));
    if (!ok) {
      if (c.req.method === "GET") return c.redirect("/admin/login", 302);
      return c.text("Unauthorized", 401);
    }
    return next();
  });

  admin.get("/login", (c) => c.html(loginPage(null)));

  admin.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const password =
      typeof form["password"] === "string" ? form["password"] : "";
    if (password === "" || !verifyPassword(password, c.env.ADMIN_PASSWORD)) {
      return c.html(loginPage("Password salah"));
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const value = await signSession(
      c.env.ADMIN_SECRET,
      nowSec + ADMIN_SESSION_TTL_SEC,
    );
    c.header(
      "Set-Cookie",
      `${ADMIN_SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/admin; Secure; Max-Age=${ADMIN_SESSION_TTL_SEC}`,
    );
    return c.redirect("/admin");
  });

  admin.post("/logout", (c) => {
    c.header(
      "Set-Cookie",
      `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin; Secure; Max-Age=0`,
    );
    return c.redirect("/admin/login");
  });

  admin.get("/", async (c) => {
    const db = createDb(c.env);
    return c.html(dashboardPage(await getAdminCounts(db)));
  });

  admin.get("/cards", async (c) => {
    const rawKind = c.req.query("kind") ?? "";
    const kind: AdminCardKindFilter =
      rawKind === "empty" || rawKind === "remote" || rawKind === "static"
        ? rawKind
        : "all";
    const q = c.req.query("q") ?? "";
    const db = createDb(c.env);
    const { rows, total } = await listAdminCards(db, {
      kind,
      q,
      limit: 100,
      offset: 0,
    });
    return c.html(
      cardsPage({ rows, total, kind, q, base: c.env.PUBLIC_BASE_URL, renderMessage: (c.req.query("msg") ?? "") === "" ? null : (c.req.query("msg") ?? ""), renderOk: (c.req.query("ok") ?? "") === "1" }),
    );
  });

  admin.post("/cards/render-remote", async (c) => {
    const fail = (message: string): Response =>
      c.redirect(
        `/admin/cards?kind=remote&ok=0&msg=${encodeURIComponent(message)}`,
      );
    const pat = c.env.GITHUB_ACTIONS_PAT;
    if (pat === undefined || pat === "") {
      return fail(
        "Render manual belum dikonfigurasi (GitHub PAT kosong). Cron 15 menit tetap berjalan.",
      );
    }
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return fail("Form tidak terbaca.");
    }
    const rawIds = formData
      .getAll("ids")
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v !== "");
    if (rawIds.length === 0) return fail("Pilih minimal 1 kartu remote.");
    if (rawIds.length > 50) return fail("Maksimal 50 kartu per render.");
    const renderable = await listRenderableCards(createDb(c.env), rawIds);
    if (renderable.length === 0) {
      return fail("Tidak ada kartu remote valid dari pilihan.");
    }
    const skipped = rawIds.length - renderable.length;
    const repo =
      c.env.GITHUB_REPO === undefined || c.env.GITHUB_REPO === ""
        ? "yvdist/gatchawek"
        : c.env.GITHUB_REPO;
    const res = await fetch(
      `https://api.github.com/repos/${repo}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "render-remote",
          client_payload: {
            ids: renderable.map((r) => r.id).join(","),
          },
        }),
      },
    );
    if (!res.ok) {
      return fail(`GitHub dispatch gagal (${String(res.status)}). Coba lagi.`);
    }
    const skipNote = skipped > 0 ? ` (${String(skipped)} dilewati)` : "";
    return c.redirect(
      `/admin/cards?kind=remote&ok=1&msg=${encodeURIComponent(`Render ${String(renderable.length)} kartu diminta${skipNote}. Cek lagi ~15 menit.`)}`,
    );
  });

  admin.get("/cards/:id", async (c) => {
    const id = c.req.param("id");
    const card = await getAdminCard(createDb(c.env), id);
    if (card === null) return c.text("Kartu tidak ditemukan", 404);
    const message = c.req.query("msg") ?? null;
    return c.html(
      cardDetailPage({
        card,
        base: c.env.PUBLIC_BASE_URL,
        message: message === "" ? null : message,
        ok: (c.req.query("ok") ?? "") === "1",
      }),
    );
  });

  admin.post("/cards/:id/image", async (c) => {
    const id = c.req.param("id");
    const db = createDb(c.env);
    const card = await getAdminCard(db, id);
    if (card === null) return c.text("Kartu tidak ditemukan", 404);
    const fail = (message: string): Response =>
      c.html(
        cardDetailPage({
          card,
          base: c.env.PUBLIC_BASE_URL,
          message,
          ok: false,
        }),
      );
    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody();
    } catch {
      return fail("Form tidak terbaca.");
    }
    const file = form["file"];
    const url =
      typeof form["url"] === "string" ? form["url"].trim() : "";
    const done = (message: string): Response =>
      c.redirect(
        `/admin/cards/${encodeURIComponent(id)}?ok=1&msg=${encodeURIComponent(message)}`,
      );
    if (file instanceof File && file.size > 0) {
      const uploaded = await uploadImageToDiscord(
        c.env,
        file,
        `🗂️ admin upload untuk ${id} oleh owner`,
      );
      if (!uploaded.ok) return fail(uploaded.error);
      await setAdminCardImage(db, id, uploaded.url);
      return done("Image diperbarui (remote/CDN).");
    }
    if (url !== "") {
      if (!url.startsWith("https://")) {
        return fail("URL harus diawali https://");
      }
      if (url.length > MAX_MANUAL_URL_LEN) {
        return fail("URL terlalu panjang (maks 500).");
      }
      await setAdminCardImage(db, id, url);
      return done("Image diperbarui (remote/CDN).");
    }
    return fail("Pilih file upload atau isi URL manual.");
  });

  admin.post("/cards/:id/enabled", async (c) => {
    const id = c.req.param("id");
    const form = await c.req.parseBody();
    const enabled = form["enabled"] === "1";
    const ok = await setAdminCardEnabled(createDb(c.env), id, enabled);
    if (!ok) return c.text("Kartu tidak ditemukan", 404);
    return c.redirect(`/admin/cards/${encodeURIComponent(id)}`);
  });

  admin.get("/inject", async (c) => {
    const raw = c.req.query("status") ?? "";
    const status: AdminQueueStatus =
      raw === "approved" || raw === "rejected" ? raw : "pending";
    const { rows, total } = await listAdminQueue(
      createDb(c.env),
      status,
      100,
      0,
    );
    return c.html(
      injectPage({
        rows,
        total,
        status,
        ok: c.req.query("ok") || null,
      }),
    );
  });

  admin.post("/inject/:messageId/approve", async (c) => {
    const messageId = c.req.param("messageId");
    const db = createDb(c.env);
    const outcome = await approveQueued(db, messageId, "admin-web", Date.now());
    if (outcome.status !== "ok") {
      const pending = await listAdminQueue(db, "pending", 100, 0);
      return c.html(
        injectPage({
          rows: pending.rows,
          total: pending.total,
          status: "pending",
          ok: `Approve gagal: ${outcome.status}`,
        }),
      );
    }
    return c.redirect(
      `/admin/inject?status=approved&ok=${encodeURIComponent(`Approved → ${outcome.cardId}`)}`,
    );
  });

  admin.post("/inject/:messageId/reject", async (c) => {
    const messageId = c.req.param("messageId");
    await rejectQueued(createDb(c.env), messageId, "admin-web", Date.now());
    return c.redirect("/admin/inject?status=rejected");
  });

  admin.get("/import", async (c) => {
    const poolGroups = await listAdminPoolGroups(createDb(c.env));
    return c.html(importPage({ poolGroups }));
  });

  admin.post("/import", async (c) => {
    const wantsJson = (c.req.header("accept") ?? "").includes(
      "application/json",
    );
    const db = createDb(c.env);
    const poolGroups = await listAdminPoolGroups(db);
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      const msg = "Form tidak terbaca.";
      return wantsJson
        ? c.json({ ok: false, error: msg, results: [] }, 400)
        : c.html(importPage({ poolGroups, error: msg }), 400);
    }

    const poolGroupRaw = formData.get("poolGroup");
    const poolGroupStr =
      typeof poolGroupRaw === "string" ? poolGroupRaw.trim() : "";
    const sep = poolGroupStr.indexOf(":");
    const poolId = sep > 0 ? poolGroupStr.slice(0, sep) : "";
    const groupId = sep > 0 ? poolGroupStr.slice(sep + 1) : "";
    const target = poolGroups.find(
      (pg) => pg.poolId === poolId && pg.groupId === groupId,
    );
    if (target === undefined) {
      const msg = "Pilih target pool dan grup yang valid.";
      return wantsJson
        ? c.json({ ok: false, error: msg, results: [] }, 400)
        : c.html(importPage({ poolGroups, error: msg }), 400);
    }

    const rawFiles = [
      ...formData.getAll("files"),
      ...formData.getAll("file"),
    ].filter((v): v is File => v instanceof File && v.size > 0);
    if (rawFiles.length === 0) {
      const msg = "Pilih minimal 1 file gambar.";
      return wantsJson
        ? c.json({ ok: false, error: msg, results: [] }, 400)
        : c.html(importPage({ poolGroups, error: msg }), 400);
    }

    const namaList = formData
      .getAll("nama")
      .map((v) => (typeof v === "string" ? v : ""));
    const rarityList = formData
      .getAll("rarity")
      .map((v) => (typeof v === "string" ? v : ""));
    const labelList = formData
      .getAll("label")
      .map((v) => (typeof v === "string" ? v : ""));

    const results: ImportBatchItemResult[] = [];
    const createdInBatch = new Set<string>();
    const baseNow = Date.now();
    for (let i = 0; i < rawFiles.length; i += 1) {
      const file = rawFiles[i];
      if (file === undefined) continue;
      const parsed = parseCardFilename(file.name);
      const namaOverride = (namaList[i] ?? "").trim();
      const nama = namaOverride !== "" ? namaOverride : parsed.nama;
      if (nama === "") {
        results.push({
          filename: file.name,
          ok: false,
          message: "Nama kartu wajib diisi.",
        });
        continue;
      }
      const rarityRaw = (rarityList[i] ?? "").trim();
      const rarity =
        rarityRaw !== "" ? parseRarityAlias(rarityRaw) : parsed.rarity;
      if (rarity === null) {
        results.push({
          filename: file.name,
          ok: false,
          message: "Rarity tidak valid atau tidak terdeteksi dari nama file.",
        });
        continue;
      }
      const labelRaw = (labelList[i] ?? "").trim();
      if (labelRaw.length > MAX_LABEL_LEN) {
        results.push({
          filename: file.name,
          ok: false,
          message: `Label maks ${String(MAX_LABEL_LEN)} karakter.`,
        });
        continue;
      }
      let destPoolId = target.poolId;
      let destGroupId = target.groupId;
      let createdGroupName: string | null = null;
      if (parsed.rawGroup !== null) {
        const planned = planGroupForImport(
          parsed.rawGroup,
          poolGroups,
          target.poolId,
        );
        if (planned === "ambiguous") {
          results.push({
            filename: file.name,
            ok: false,
            message: `Grup "${parsed.rawGroup}" ambigu, pilih lebih spesifik.`,
          });
          continue;
        }
        if (planned === "use-dropdown") {
          // Legacy 2-segment form: keep the dropdown target.
        } else if ("create" in planned) {
          const clash = poolGroups.find(
            (pg) =>
              pg.poolId === planned.create.poolId &&
              pg.groupId === planned.create.groupId,
          );
          if (clash !== undefined) {
            results.push({
              filename: file.name,
              ok: false,
              message: `Grup "${parsed.rawGroup}" ambigu, pilih lebih spesifik.`,
            });
            continue;
          }
          const createdKey = `${planned.create.poolId}:${planned.create.groupId}`;
          if (!createdInBatch.has(createdKey)) {
            await ensureImportGroup(db, planned.create);
            poolGroups.push({
              poolId: planned.create.poolId,
              poolName: target.poolName,
              poolEmoji: target.poolEmoji,
              groupId: planned.create.groupId,
              groupName: planned.create.name,
              groupBadge: planned.create.badge,
            });
            createdInBatch.add(createdKey);
          }
          destPoolId = planned.create.poolId;
          destGroupId = planned.create.groupId;
          createdGroupName = planned.create.name;
        } else if ("use" in planned) {
          destPoolId = planned.use.poolId;
          destGroupId = planned.use.groupId;
        }
      }
      const uploaded = await uploadImageToDiscord(
        c.env,
        file,
        `📥 admin import ${nama} (${rarity}) oleh owner`,
      );
      if (!uploaded.ok) {
        results.push({
          filename: file.name,
          ok: false,
          message: uploaded.error,
        });
        continue;
      }
      const outcome = await importAdminCard(db, {
        poolId: destPoolId,
        groupId: destGroupId,
        nama,
        rarity,
        label: labelRaw !== "" ? labelRaw : null,
        imageUrl: uploaded.url,
        messageUrl: uploaded.messageUrl,
        channelId: c.env.INGEST_CHANNEL_ID,
        guildId: c.env.INGEST_GUILD_ID,
        now: baseNow + i,
      });
      if (outcome.status === "ok") {
        results.push({
          filename: file.name,
          ok: true,
          message:
            createdGroupName === null
              ? `${outcome.cardId} (${outcome.rarity}, No. ${String(outcome.serial)})`
              : `${outcome.cardId} (${outcome.rarity}, No. ${String(outcome.serial)}) · grup baru ${createdGroupName}`,
          cardId: outcome.cardId,
          serial: outcome.serial,
        });
      } else if (outcome.status === "member-group-mismatch") {
        results.push({
          filename: file.name,
          ok: false,
          message: `Member "${nama}" sudah terdaftar di ${outcome.existingPoolId}/${outcome.existingGroupId}.`,
        });
      } else if (outcome.status === "unknown-group") {
        results.push({
          filename: file.name,
          ok: false,
          message: "Pool/grup tidak ditemukan.",
        });
      } else if (outcome.status === "conflict") {
        results.push({
          filename: file.name,
          ok: false,
          message: "Konflik serial/foto, coba lagi.",
        });
      } else {
        results.push({
          filename: file.name,
          ok: false,
          message: outcome.error,
        });
      }
    }

    const allOk = results.every((r) => r.ok);
    if (wantsJson) {
      return c.json({ ok: allOk, results });
    }
    return c.html(importPage({ poolGroups, results, error: null }));
  });

  // Mounted under /admin by the caller.
  app.route("/admin", admin);
}
