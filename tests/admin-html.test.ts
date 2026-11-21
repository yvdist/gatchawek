import { describe, expect, it } from "vitest";
import {
  cardDetailPage,
  cardsPage,
  dashboardPage,
  importPage,
  injectPage,
  loginPage,
  quotaPage,
} from "../src/ui/adminHtml.js";
import type { AdminCardDetail } from "../src/db/queries/admin.js";

function detail(overrides: Partial<AdminCardDetail> = {}): AdminCardDetail {
  return {
    id: "teddy-01",
    memberName: "Teddy",
    groupBadge: "G1",
    groupId: "g1",
    poolName: "Pejabat",
    photoNo: 1,
    rarity: "ultra_rare",
    imageFile: "teddy.webp",
    imageKind: "static",
    enabled: true,
    quantityOwned: 3,
    renderable: false,
    renderPending: false,
    excludedPool: false,
    renderRequestedAt: null,
    photoLabel: null,
    fullName: null,
    photoTotal: 5,
    serial: 1,
    sourcePageUrl: null,
    holoEnabled: false,
    ...overrides,
  };
}

describe("loginPage", () => {
  it("renders the password form without a username field", () => {
    const html = loginPage(null);
    expect(html).toContain('name="password"');
    expect(html).not.toContain('name="username"');
    expect(html).not.toContain("<script");
  });

  it("shows the error message", () => {
    expect(loginPage("Password salah")).toContain("Password salah");
  });
});

describe("quotaPage", () => {
  it("names the reset time and offers a retry link", () => {
    const html = quotaPage();
    expect(html).toContain("Kuota baca database habis");
    expect(html).toContain("00:00 UTC");
    expect(html).toContain('href="/admin"');
  });
});

describe("dashboardPage", () => {
  it("shows all four counts with links", () => {
    const html = dashboardPage({ total: 10, empty: 2, remote: 3, pending: 1, renderStale: 2 });
    expect(html).toContain("Render gagal?");
    expect(html).toContain("kind=empty");
    expect(html).toContain("kind=remote");
    expect(html).toContain("status=pending");
  });
});

describe("cardsPage", () => {
  it("escapes member names", () => {
    const html = cardsPage({
      rows: [
        {
          id: "x-01",
          memberName: "<script>alert(1)</script>",
          groupBadge: "G",
          groupId: "g1",
          poolName: "P",
          poolId: "ahli-ngebul",
          photoNo: 1,
          rarity: "common",
          imageFile: "a.webp",
          imageKind: "static",
          enabled: true,
          quantityOwned: 0,
          renderable: false,
          renderPending: false,
          excludedPool: false,
          renderRequestedAt: null,
        },
      ],
      total: 1,
      kind: "all",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders each image kind as a rendered or raw tile", () => {
    for (const kind of ["empty", "remote", "static"] as const) {
      const imageFile = kind === "empty" ? "" : kind === "remote" ? "https://x/y.png" : "a.webp";
      const html = cardsPage({
        rows: [
          {
            id: `${kind}-01`,
            memberName: "M",
            groupBadge: "G",
            groupId: "g1",
            poolName: "P",
            poolId: "ahli-ngebul",
            photoNo: 1,
            rarity: "common",
            imageFile,
            imageKind: kind,
            enabled: true,
            quantityOwned: 0,
            renderable: kind === "remote",
            renderPending: false,
            excludedPool: false,
            renderRequestedAt: null,
          },
        ],
        total: 1,
        kind: "all",
        q: "",
        base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      });
      expect(html).toContain(kind === "static" ? "tile is-rendered" : "tile is-raw");
      expect(html).not.toContain("<table");
    }
  });
});

describe("cardsPage queue and render cap", () => {
  const base = {
    id: "x-01",
    memberName: "M",
    groupBadge: "G",
    groupId: "g1",
    poolName: "P",
    poolId: "ahli-ngebul",
    photoNo: 1,
    rarity: "common" as const,
    imageFile: "https://cdn.example/x.jpg",
    imageKind: "remote" as const,
    enabled: true,
    quantityOwned: 0,
    renderable: true,
    renderPending: false,
    excludedPool: false,
    renderRequestedAt: null,
  };

  it("labels filter tabs by meaning and links the todo queue", () => {
    const html = cardsPage({ rows: [], total: 0, kind: "todo", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain("kind=todo");
    expect(html).toContain("Perlu dikerjakan");
    expect(html).toContain("Belum dirender");
    expect(html).toContain("Selesai");
  });

  it("shows excluded-pool photos as final, without a render checkbox", () => {
    const html = cardsPage({
      rows: [{ ...base, id: "p-01", renderable: false, excludedPool: true, enabled: false }],
      total: 1,
      kind: "static",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(html).toContain("tile is-final");
    expect(html).toContain("foto asli");
    expect(html).not.toContain('value="p-01"');
    // The bar stays put but offers nothing to pick: no checkbox, disabled submit.
    expect(html).not.toContain('id="pickAll"');
    expect(html).toContain("Tidak ada kartu yang perlu dirender");
  });

  it("offers bulk render on the default todo tab; pending cards get a time chip, not a checkbox", () => {
    const html = cardsPage({
      rows: [base, { ...base, id: "x-02", renderPending: true, renderRequestedAt: 1000 - 240 }],
      total: 2,
      kind: "todo",
      q: "jo",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      nowSec: 1000,
    });
    expect(html).toContain('action="/admin/cards/render-remote"');
    expect(html).toContain('name="ids" value="x-01"');
    expect(html).not.toContain('value="x-02"');
    expect(html).toContain("diminta 4 mnt lalu");
    expect(html).toContain("Pilih semua (1)");
    expect(html).toContain('name="back" value="/admin/cards?kind=todo&amp;q=jo"');
  });

  it("keeps tiles to pool and group; ownership lives on the detail page", () => {
    const html = cardsPage({ rows: [base], total: 1, kind: "all", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).not.toContain("dimiliki");
  });

  it("links tiles back to the exact list view", () => {
    const html = cardsPage({ rows: [base], total: 1, kind: "remote", q: "jo", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain(`/admin/cards/x-01?from=${encodeURIComponent("/admin/cards?kind=remote&q=jo")}`);
  });

  it("caps render selection at 50 in the client script", () => {
    const html = cardsPage({ rows: [base], total: 1, kind: "remote", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain("var MAX=50");
  });

  it("does not use eyebrow labels and says when the list is truncated", () => {
    const html = cardsPage({ rows: [base], total: 250, kind: "all", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).not.toContain('class="eyebrow"');
    expect(html).toContain("1 dari 250");
  });

  it("takes rarity colors from the bot's RARITY_COLOR", () => {
    const html = cardsPage({ rows: [], total: 0, kind: "all", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain("--r-holo:#ffd700");
    expect(html).toContain("--r-super_rare:#f59e0b");
  });
});

describe("cardsPage round 4", () => {
  const base = {
    id: "x-01",
    memberName: "Mira",
    groupBadge: "G",
    groupId: "g1",
    poolName: "P",
    poolId: "ahli-ngebul",
    photoNo: 1,
    rarity: "rare" as const,
    imageFile: "https://cdn.example/x.jpg",
    imageKind: "remote" as const,
    enabled: true,
    quantityOwned: 0,
    renderable: true,
    renderPending: false,
    excludedPool: false,
    renderRequestedAt: null,
  };

  it("flags a request whose window passed without a render, and keeps it selectable", () => {
    const html = cardsPage({
      rows: [{ ...base, renderRequestedAt: 10_000 - 47 * 60 }],
      total: 1,
      kind: "todo",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      nowSec: 10_000,
    });
    expect(html).toContain("render gagal? diminta 47 mnt lalu");
    expect(html).toContain('name="ids" value="x-01"');
  });

  it("shows per-tab counts", () => {
    const html = cardsPage({
      rows: [],
      total: 0,
      kind: "todo",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      counts: { todo: 5, empty: 2, remote: 3, static: 9, all: 14 },
    });
    expect(html).toContain('Belum dirender <span class="tab-n">3</span>');
    expect(html).toContain('Selesai <span class="tab-n">9</span>');
  });

  it("puts name and stars under every tile, including finished ones", () => {
    const html = cardsPage({
      rows: [{ ...base, imageKind: "static", imageFile: "a.webp", renderable: false }],
      total: 1,
      kind: "static",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(html).toContain('<span class="tile-name">Mira</span>');
    expect(html).toContain("★★");
  });
});

describe("round 5: one state vocabulary, rarity dot, mobile filter", () => {
  const base = {
    id: "x-01",
    memberName: "Mira",
    groupBadge: "G",
    groupId: "g1",
    poolName: "P",
    poolId: "ahli-ngebul",
    photoNo: 1,
    rarity: "rare" as const,
    imageFile: "https://cdn.example/x.jpg",
    imageKind: "remote" as const,
    enabled: true,
    quantityOwned: 0,
    renderable: true,
    renderPending: false,
    excludedPool: false,
    renderRequestedAt: null,
  };

  it("uses the same tone class for a state on tile tag and badge", () => {
    const list = cardsPage({ rows: [base], total: 1, kind: "todo", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(list).toContain('class="sheet-tag tone-raw"');
    const detailHtml = cardDetailPage({ card: { ...detail(), ...base, photoTotal: 1 }, base: "example.test", message: null, ok: false, pools: [], poolGroups: [] });
    expect(detailHtml).toContain('class="badge tone-raw"');
  });

  it("marks rarity with a colored dot next to grey stars", () => {
    const html = cardsPage({ rows: [base], total: 1, kind: "todo", q: "", base: "example.test", poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain('<i class="rdot"></i>');
  });

  it("offers a select filter for narrow screens and refreshes while renders are pending", () => {
    const html = cardsPage({
      rows: [{ ...base, renderPending: true, renderRequestedAt: 1900 }],
      total: 1,
      kind: "todo",
      q: "",
      base: "example.test",
      nowSec: 2000,
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      counts: { todo: 1, empty: 0, remote: 1, static: 0, all: 1 },
    });
    expect(html).toContain('class="filter-select"');
    expect(html).toContain("Perlu dikerjakan (1)");
    expect(html).toContain("location.reload()");
  });
});

describe("round 6", () => {
  const base = {
    id: "x-01",
    memberName: "Mira",
    groupBadge: "G",
    groupId: "g1",
    poolName: "P",
    poolId: "ahli-ngebul",
    photoNo: 1,
    rarity: "rare" as const,
    imageFile: "https://cdn.example/x.jpg",
    imageKind: "remote" as const,
    enabled: true,
    quantityOwned: 0,
    renderable: true,
    renderPending: false,
    excludedPool: false,
    renderRequestedAt: null,
  };

  it("offers a one-click selection of failed renders", () => {
    const html = cardsPage({
      rows: [base, { ...base, id: "x-02", renderRequestedAt: 1 }],
      total: 2,
      kind: "todo",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      nowSec: 100_000,
    });
    expect(html).toContain('id="pickStale"');
    expect(html).toContain("Pilih yang gagal (1)");
    expect(html).toContain('value="x-02" data-stale');
  });

  it("tells the owner when the page refreshes itself", () => {
    const html = cardsPage({
      rows: [{ ...base, renderPending: true, renderRequestedAt: 1900 }],
      total: 1,
      kind: "todo",
      q: "",
      base: "example.test",
      nowSec: 2000,
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(html).toContain("Diperbarui otomatis tiap 1 menit");
  });

  it("leads the dashboard with work, totals demoted, and no link on zero", () => {
    const html = dashboardPage({ total: 132, empty: 0, remote: 21, pending: 3, renderStale: 2 });
    expect(html).toContain("132 kartu di katalog");
    expect(html).toContain("stat tone-stale");
    expect(html).not.toContain("kind=empty");
  });
});

describe("cardDetailPage", () => {
  it("tucks image replacement on a rendered card behind a confirmed details section", () => {
    const html = cardDetailPage({ card: detail(), base: "example.test", message: null, ok: false, pools: [], poolGroups: [] });
    expect(html).toContain('<details class="card replace">');
    expect(html).toContain("<summary>Ganti image</summary>");
    expect(html).toContain("return confirm(");
  });

  it("has multipart upload and manual URL forms", () => {
    const html = cardDetailPage({
      card: detail(),
      base: "example.test",
      pools: [],
      poolGroups: [],
      message: null,
      ok: false,
    });
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="file"');
    expect(html).toContain('name="url"');
  });

  it("carries the list context through every form and links neighbours", () => {
    const html = cardDetailPage({
      card: detail({ imageKind: "remote", imageFile: "https://x/y.png", renderable: true }),
      base: "example.test",
      pools: [],
      poolGroups: [],
      message: null,
      ok: false,
      back: "/admin/cards?kind=todo",
      prev: { id: "a-01", name: "Ana" },
      next: { id: "c-01", name: "Cici" },
    });
    expect(html).toContain('name="from" value="/admin/cards?kind=todo"');
    expect(html).toContain(`href="/admin/cards/c-01?from=${encodeURIComponent("/admin/cards?kind=todo")}"`);
    expect(html).toContain("Cici");
    expect(html).toContain(`name="back" value="/admin/cards/teddy-01?from=${encodeURIComponent("/admin/cards?kind=todo")}"`);
  });

  it("offers a single-card render that returns to the card", () => {
    const html = cardDetailPage({
      card: detail({ imageKind: "remote", imageFile: "https://x/y.png", renderable: true }),
      base: "example.test",
      pools: [],
      poolGroups: [],
      message: null,
      ok: false,
      back: "/admin/cards?kind=remote",
    });
    expect(html).toContain("Minta render kartu ini");
    expect(html).toContain('name="back" value="/admin/cards/teddy-01?from=');
    expect(html).toContain('href="/admin/cards?kind=remote"');
  });

  it("warns on remote images", () => {
    const html = cardDetailPage({
      card: detail({ imageKind: "remote", imageFile: "https://x/y.png", renderable: true }),
      base: "example.test",
      pools: [],
      poolGroups: [],
      message: null,
      ok: true,
    });
    expect(html).toContain("belum dirender");
    expect(html).not.toContain("fetch-images");
  });
});

describe("cardsPage pool/group/rarity filters", () => {
  const base = {
    id: "x-01",
    memberName: "Mira",
    groupBadge: "G",
    groupId: "g1",
    poolName: "P",
    poolId: "ahli-ngebul",
    photoNo: 1,
    rarity: "rare" as const,
    imageFile: "a.webp",
    imageKind: "static" as const,
    enabled: true,
    quantityOwned: 0,
    renderable: false,
    renderPending: false,
    excludedPool: false,
    renderRequestedAt: null,
  };
  const pools = [{ poolId: "ahli-ngebul", poolName: "Ahli Ngebul", poolEmoji: "x" }];
  const poolGroups = [{ poolId: "ahli-ngebul", poolName: "Ahli Ngebul", poolEmoji: "x", groupId: "g1", groupName: "Satu", groupBadge: "SATU" }];

  it("renders pool/group/rarity selects with the active value selected", () => {
    const html = cardsPage({ rows: [base], total: 1, kind: "all", q: "", base: "example.test", poolId: "ahli-ngebul", groupId: "g1", rarity: "rare", pools, poolGroups });
    expect(html).toContain('name="pool"');
    expect(html).toContain('name="group"');
    expect(html).toContain('name="rarity"');
    expect(html).toContain('<option value="ahli-ngebul" selected>');
    expect(html).toContain('<option value="g1" selected>');
    expect(html).toContain('<option value="rare" selected>');
  });

  it("threads filters through tab links and keeps them in search", () => {
    const html = cardsPage({ rows: [base], total: 1, kind: "remote", q: "jo", base: "example.test", poolId: "ahli-ngebul", groupId: "", rarity: "rare", pools, poolGroups });
    expect(html).toContain("pool=ahli-ngebul");
    expect(html).toContain("rarity=rare");
    expect(html).toContain('name="pool" value="ahli-ngebul"');
    expect(html).toContain('name="rarity" value="rare"');
  });
});

describe("render pending overlay", () => {
  it("marks pending tiles with a spinner tag and sheen", () => {
    const html = cardsPage({ rows: [{ id: "x-01", memberName: "M", groupBadge: "G", groupId: "g1", poolName: "P", poolId: "p1", photoNo: 1, rarity: "rare", imageFile: "https://cdn.example/x.jpg", imageKind: "remote", enabled: true, quantityOwned: 0, renderable: true, renderPending: true, excludedPool: false, renderRequestedAt: 1000 }], total: 1, kind: "todo", q: "", base: "example.test", nowSec: 1060, poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain("tile is-raw is-pending");
    expect(html).toContain("@keyframes render-spin");
    expect(html).toContain("@keyframes render-sheen");
  });
});

describe("render ulang dari Sumber", () => {
  it("offers source re-render for rendered cards with an http source", () => {
    const html = cardDetailPage({ card: detail({ imageFile: "x-01.abcdef12.webp", imageKind: "static", sourcePageUrl: "https://cdn.example/x.jpg", renderable: false }), base: "example.test", message: null, ok: false, pools: [], poolGroups: [] });
    expect(html).toContain("Render ulang dari Sumber");
  });

  it("hides source re-render when there is no source URL", () => {
    const html = cardDetailPage({ card: detail({ imageFile: "x-01.abcdef12.webp", imageKind: "static", sourcePageUrl: null, renderable: false }), base: "example.test", message: null, ok: false, pools: [], poolGroups: [] });
    expect(html).not.toContain("Render ulang dari Sumber");
  });
});

describe("static re-render pending state", () => {
  const base = { id: "x-01", memberName: "M", groupBadge: "G", groupId: "g1", poolName: "P", poolId: "p1", photoNo: 1, rarity: "common" as const, imageFile: "x-01.abcdef12.webp", imageKind: "static" as const, enabled: true, quantityOwned: 0, renderable: false, renderPending: false, excludedPool: false, renderRequestedAt: null };

  it("shows a static card as pending while its re-render request is fresh", () => {
    const html = cardsPage({ rows: [{ ...base, renderRequestedAt: 1000 }], total: 1, kind: "all", q: "", base: "example.test", nowSec: 1010, poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain("tile is-raw is-pending");
    expect(html).toContain("diminta barusan");
  });

  it("shows the same static card as rendered once the request window passes", () => {
    const html = cardsPage({ rows: [{ ...base, renderRequestedAt: 1000 }], total: 1, kind: "all", q: "", base: "example.test", nowSec: 1000 + 1900, poolId: "", groupId: "", rarity: "", pools: [], poolGroups: [] });
    expect(html).toContain("tile is-rendered");
  });
});

describe("cardDetailPage kelola form", () => {
  const pools = [
    { poolId: "pejabat", poolName: "Pejabat", poolEmoji: "x" },
    { poolId: "ahli-ngebul", poolName: "Ahli Ngebul", poolEmoji: "x" },
  ];
  const poolGroups = [
    { poolId: "pejabat", poolName: "Pejabat", poolEmoji: "x", groupId: "g1", groupName: "Satu", groupBadge: "SATU" },
    { poolId: "pejabat", poolName: "Pejabat", poolEmoji: "x", groupId: "g2", groupName: "Dua", groupBadge: "DUA" },
    { poolId: "ahli-ngebul", poolName: "Ahli Ngebul", poolEmoji: "x", groupId: "ng1", groupName: "Default", groupBadge: "NGEBUL" },
  ];
  const card = detail({ poolId: "pejabat" });

  it("renders a manage form with member, label, pool, group, rarity, and holo fields", () => {
    const html = cardDetailPage({ card, base: "example.test", message: null, ok: false, pools, poolGroups });
    expect(html).toContain('name="memberName"');
    expect(html).toContain('name="photoLabel"');
    expect(html).toContain('name="poolId"');
    expect(html).toContain('name="groupId"');
    expect(html).toContain('name="rarity"');
    expect(html).toContain('name="holoEnabled"');
  });

  it("lists only the current pool's groups and offers a new group", () => {
    const html = cardDetailPage({ card, base: "example.test", message: null, ok: false, pools, poolGroups });
    expect(html).toContain('<option value="g1" selected>Satu</option>');
    expect(html).toContain('<option value="g2">Dua</option>');
    expect(html).not.toContain('<option value="ng1"');
    expect(html).toContain("+ Grup baru…");
    expect(html).toContain('name="groupName"');
    expect(html).toContain('<div class="field is-hidden" id="mGroupNew">');
  });

  it("keeps a submitted pool/group visible when a save fails", () => {
    const html = cardDetailPage({
      card,
      base: "example.test",
      message: "Pool tidak ditemukan.",
      ok: false,
      pools,
      poolGroups,
      draft: {
        memberName: "Teddy",
        photoLabel: null,
        rarity: "ultra_rare",
        poolId: "ahli-ngebul",
        groupId: "ng1",
        groupName: "",
        holoEnabled: false,
      },
    });
    expect(html).toContain('<option value="ahli-ngebul" selected>');
    expect(html).toContain('<option value="ng1" selected>Default</option>');
  });

  it("reveals the new-group name field for the sentinel option", () => {
    const html = cardDetailPage({
      card,
      base: "example.test",
      message: null,
      ok: false,
      pools,
      poolGroups,
      draft: {
        memberName: "Teddy",
        photoLabel: null,
        rarity: "ultra_rare",
        poolId: "ahli-ngebul",
        groupId: "__new__",
        groupName: "Archi",
        holoEnabled: false,
      },
    });
    expect(html).toContain('<option value="__new__" selected>+ Grup baru…</option>');
    expect(html).toContain('name="groupName" value="Archi"');
    expect(html).toContain('<div class="field" id="mGroupNew">');
  });
});

describe("injectPage", () => {
  const row = {
    messageId: "m1",
    channelId: "c",
    guildId: "g",
    authorId: null,
    submittedAt: 5,
    messageUrl: "https://discord/x",
    nama: "Rapih",
    memberId: null,
    pool: "pejabat",
    grup: "g1",
    rarity: "common" as const,
    label: null,
    sumber: null,
    imageUrl: "https://x/y.png",
    status: "pending" as const,
    errors: null,
  };

  it("shows approve only for pending rows", () => {
    const pending = injectPage({
      rows: [row],
      total: 1,
      status: "pending",
      ok: null,
    });
    expect(pending).toContain("m1/approve");
    expect(pending).toContain("m1/reject");
    const approved = injectPage({
      rows: [{ ...row, status: "approved" }],
      total: 1,
      status: "approved",
      ok: null,
    });
    expect(approved).not.toContain("m1/approve");
    expect(approved).not.toContain("m1/reject");
  });
});

describe("importPage", () => {
  const pools = [
    {
      poolId: "ahli-ngebul",
      poolName: "Ahli Ngebul",
      poolEmoji: "💨",
    },
  ];

  it("renders drag-and-drop import UI, template guide, and Holo/Secret options", () => {
    const html = importPage({ pools });
    expect(html).toContain('id="dropzone"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain("(rarity) - nama grup - nama kartu.ext");
    expect(html).toContain("(secret) - Jomok - Refi Kaget.jpg");
    expect(html).toContain("★★★★★★ Secret");
    expect(html).toContain("(holo) - refi kaget.jpg");
    expect(html).toContain("★★★★★ Holo");
    expect(html).toContain("(secret)");
    expect(html).toContain('value="ahli-ngebul"');
    expect(html).toContain("💨 Ahli Ngebul");
    expect(html).not.toContain("ahli-ngebul:default");
  });

  it("escapes error messages, pool labels, and batch result filenames", () => {
    const basePool = pools[0];
    if (basePool === undefined) throw new Error("expected fixture");
    const html = importPage({
      pools: [
        {
          ...basePool,
          poolName: "<script>bad()</script>",
        },
      ],
      error: "<img src=x onerror=alert(1)>",
      results: [
        {
          filename: "<svg onload=alert(1)>.jpg",
          ok: true,
          message: "ok",
        },
      ],
    });
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<svg onload=alert(1)>");
  });

  it("disables submit when no active pools exist", () => {
    const html = importPage({ pools: [] });
    expect(html).toContain("Belum ada pool aktif");
    expect(html).toContain('id="submitBtn" disabled');
  });

  it("renders the shared dark shell with active nav and theme tokens", () => {
    const html = importPage({ pools });
    expect(html).toContain('class="topbar"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("--bg:");
  });

  it("tints each tile with its rarity class", () => {
    const html = cardsPage({
      rows: [
        {
          id: "r-01",
          memberName: "M",
          groupBadge: "G",
          groupId: "g1",
          poolName: "P",
          poolId: "ahli-ngebul",
          photoNo: 1,
          rarity: "secret",
          imageFile: "a.webp",
          imageKind: "static",
          enabled: true,
          quantityOwned: 0,
          renderable: false,
          renderPending: false,
          excludedPool: false,
          renderRequestedAt: null,
        },
      ],
      total: 1,
      kind: "all",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(html).toContain("tile is-rendered r-secret");
  });

  it("keeps the dropzone contract with label, file input, and aria", () => {
    const html = importPage({ pools });
    expect(html).toContain('id="dropzone"');
    expect(html).toContain('aria-label="Seret dan lepas gambar ke sini atau klik untuk memilih file"');
    expect(html).toContain('for="fileInput"');
    expect(html).toContain('id="fileInput"');
  });

  it("wraps data tables in a scroll container", () => {
    const forCards = cardsPage({
      rows: [],
      total: 0,
      kind: "all",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(forCards).not.toContain("<table");
    expect(forCards).toContain('class="empty-state"');
    const forInject = injectPage({ rows: [], total: 0, status: "pending", ok: null });
    expect(forInject).not.toContain("<table");
    expect(forInject).toContain("Tidak ada kiriman yang menunggu review.");
    expect(importPage({ pools })).toContain('class="tablewrap"');
  });

  it("keeps the bulk bar on screen and enables picking only for renderable cards", () => {
    const row = {
      id: "r-01",
      memberName: "M",
      groupBadge: "G",
      groupId: "g1",
      poolName: "P",
      poolId: "ahli-ngebul",
      photoNo: 1,
      rarity: "rare" as const,
      imageFile: "https://cdn.example/x.jpg",
      imageKind: "remote" as const,
      enabled: true,
      quantityOwned: 0,
      renderable: true,
      renderPending: false,
      excludedPool: false,
      renderRequestedAt: null,
    };
    const remote = cardsPage({
      rows: [row],
      total: 1,
      kind: "remote",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    expect(remote).toContain('action="/admin/cards/render-remote"');
    expect(remote).toContain('name="ids" value="r-01"');
    expect(remote).toContain('id="renderBtn"');
    expect(remote).toContain("Minta render (0/50)");
    const all = cardsPage({
      rows: [{ ...row, imageKind: "static", imageFile: "a.webp", renderable: false }],
      total: 1,
      kind: "all",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    // Nothing renderable: the bar survives with a hint instead of vanishing.
    expect(all).toContain('action="/admin/cards/render-remote"');
    expect(all).not.toContain('<input type="checkbox" name="ids"');
    expect(all).not.toContain('id="pickAll"');
    expect(all).toContain("Tidak ada kartu yang perlu dirender");
  });

  it("shows the render result banner when provided", () => {
    const html = cardsPage({
      rows: [],
      total: 0,
      kind: "remote",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
      renderMessage: "Render 2 kartu diminta.",
      renderOk: true,
    });
    expect(html).toContain("Render 2 kartu diminta.");
    expect(html).toContain("is-ok");
  });

  it("hides the render checkbox for pejabat cards", () => {
    const html = cardsPage({
      rows: [
        {
          id: "p-01",
          memberName: "M",
          groupBadge: "G",
          groupId: "g1",
          poolName: "Pejabat",
          poolId: "pejabat",
          photoNo: 1,
          rarity: "rare",
          imageFile: "https://cdn.example/x.jpg",
          imageKind: "remote",
          enabled: true,
          quantityOwned: 0,
          renderable: false,
          renderPending: false,
          excludedPool: false,
          renderRequestedAt: null,
        },
      ],
      total: 1,
      kind: "remote",
      q: "",
      base: "example.test",
      poolId: "",
      groupId: "",
      rarity: "",
      pools: [],
      poolGroups: [],
    });
    // Nothing renderable on the page: no checkbox, and the bar says why.
    expect(html).not.toContain('value="p-01"');
    expect(html).not.toContain('id="pickAll"');
    expect(html).toContain("Tidak ada kartu yang perlu dirender");
  });
});
