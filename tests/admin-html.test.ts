import { describe, expect, it } from "vitest";
import {
  cardDetailPage,
  cardsPage,
  dashboardPage,
  importPage,
  injectPage,
  loginPage,
} from "../src/ui/adminHtml.js";
import type { AdminCardDetail } from "../src/db/queries/admin.js";

function detail(overrides: Partial<AdminCardDetail> = {}): AdminCardDetail {
  return {
    id: "teddy-01",
    memberName: "Teddy",
    groupBadge: "G1",
    poolName: "Pejabat",
    photoNo: 1,
    rarity: "ultra_rare",
    imageFile: "teddy.webp",
    imageKind: "static",
    enabled: true,
    quantityOwned: 3,
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

describe("dashboardPage", () => {
  it("shows all four counts with links", () => {
    const html = dashboardPage({ total: 10, empty: 2, remote: 3, pending: 1 });
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
          poolName: "P",
          photoNo: 1,
          rarity: "common",
          imageFile: "a.webp",
          imageKind: "static",
          enabled: true,
          quantityOwned: 0,
        },
      ],
      total: 1,
      kind: "all",
      q: "",
      base: "example.test",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows a badge for each image kind", () => {
    for (const kind of ["empty", "remote", "static"] as const) {
      const imageFile = kind === "empty" ? "" : kind === "remote" ? "https://x/y.png" : "a.webp";
      const html = cardsPage({
        rows: [
          {
            id: `${kind}-01`,
            memberName: "M",
            groupBadge: "G",
            poolName: "P",
            photoNo: 1,
            rarity: "common",
            imageFile,
            imageKind: kind,
            enabled: true,
            quantityOwned: 0,
          },
        ],
        total: 1,
        kind: "all",
        q: "",
        base: "example.test",
      });
      expect(html).toContain(`>${kind}<`);
    }
  });
});

describe("cardDetailPage", () => {
  it("has multipart upload and manual URL forms", () => {
    const html = cardDetailPage({
      card: detail(),
      base: "example.test",
      message: null,
      ok: false,
    });
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="file"');
    expect(html).toContain('name="url"');
  });

  it("warns on remote images", () => {
    const html = cardDetailPage({
      card: detail({ imageKind: "remote", imageFile: "https://x/y.png" }),
      base: "example.test",
      message: null,
      ok: true,
    });
    expect(html).toContain("rebuild");
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
  const poolGroups = [
    {
      poolId: "ahli-ngebul",
      poolName: "Ahli Ngebul",
      poolEmoji: "💨",
      groupId: "default",
      groupName: "Default",
      groupBadge: "NGEBUL",
    },
  ];

  it("renders drag-and-drop import UI, template guide, and Holo/Secret options", () => {
    const html = importPage({ poolGroups });
    expect(html).toContain('id="dropzone"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain("(rarity) - nama grup - nama kartu.ext");
    expect(html).toContain("(secret) - Jomok - Refi Kaget.jpg");
    expect(html).toContain("★★★★★★ Secret");
    expect(html).toContain("(holo) - refi kaget.jpg");
    expect(html).toContain("★★★★★ Holo");
    expect(html).toContain("(secret)");
    expect(html).toContain('value="ahli-ngebul:default"');
    expect(html).toContain("Ahli Ngebul · Default (NGEBUL)");
  });

  it("escapes error messages, pool labels, and batch result filenames", () => {
    const basePg = poolGroups[0];
    if (basePg === undefined) throw new Error("expected fixture");
    const html = importPage({
      poolGroups: [
        {
          ...basePg,
          groupName: "<script>bad()</script>",
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

  it("disables submit when no active pool groups exist", () => {
    const html = importPage({ poolGroups: [] });
    expect(html).toContain("Belum ada pool/grup aktif");
    expect(html).toContain('id="submitBtn" disabled');
  });
});
