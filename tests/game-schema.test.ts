import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/client.js";
import { cards, pools, groups, members, userCards, users } from "../src/db/schema.js";
import { gameCards, gameProfiles } from "../src/db/schema-game.js";
import { getOwnedCards } from "../src/db/queries/ownership.js";
import type { Env } from "../src/env.js";

/** P0-T7: the new game tables must apply cleanly on top of the legacy schema. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const GAME_TABLES = [
  "bosses",
  "decks",
  "game_cards",
  "game_profiles",
  "match_players",
  "matches",
  "ratings",
  "rewards",
];

let mf: Miniflare;
let db: Db;

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
  const env = {
    DISCORD_PUBLIC_KEY: "x",
    DB: d1,
    PUBLIC_BASE_URL: "example.test",
    DISCORD_BOT_TOKEN: "token",
  } satisfies Env;
  db = createDb(env);

  await db.insert(pools).values({
    id: "meme",
    name: "Jomok",
    emoji: "🐸",
    staminaMax: 10,
    regenIntervalSec: 1500,
    resetCooldownSec: 10800,
    memberCount: 1,
    enabled: true,
  });
  await db.insert(groups).values({ id: "jomok", poolId: "meme", name: "Jomok", badge: "JOMOK", memberCount: 1, enabled: true });
  await db.insert(members).values({ id: "jomok-mix-01", poolId: "meme", groupId: "jomok", name: "Jomok Mix 01", nameLower: "jomok mix 01", photoTotal: 2, enabled: true });
  await db.insert(cards).values([
    { id: "jomok-mix-01-01", poolId: "meme", groupId: "jomok", memberId: "jomok-mix-01", serial: 1, photoNo: 1, rarity: "common", imageFile: "jomok-mix-01-01.aaaaaaaa.webp", enabled: true },
    { id: "jomok-mix-01-02", poolId: "meme", groupId: "jomok", memberId: "jomok-mix-01", serial: 2, photoNo: 2, rarity: "rare", imageFile: "jomok-mix-01-02.bbbbbbbb.webp", enabled: true },
  ]);
  await db.insert(users).values({ id: "discord-1", createdAt: 1 });
  await db.insert(userCards).values([
    { userId: "discord-1", cardId: "jomok-mix-01-01", quantity: 3, holoQty: 1, firstObtainedAt: 1, lastObtainedAt: 2 },
    { userId: "discord-1", cardId: "jomok-mix-01-02", quantity: 1, firstObtainedAt: 1, lastObtainedAt: 1 },
  ]);
}, 60_000);

afterAll(async () => {
  await mf.dispose();
});

describe("game schema", () => {
  it("creates all game tables additively", async () => {
    const d1 = await mf.getD1Database("DB");
    const rows = await d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const names = rows.results.map((r) => r.name);
    for (const table of GAME_TABLES) expect(names).toContain(table);
  });

  it("keeps game identity in game_profiles pointing at the legacy users row", async () => {
    await db.insert(gameProfiles).values({
      userId: "discord-1",
      username: "kawan",
      createdAt: 1,
    });
    const d1 = await mf.getD1Database("DB");
    const fk = await d1.prepare("PRAGMA foreign_key_list('game_profiles')").all<{ table: string; from: string }>();
    expect(fk.results).toEqual([expect.objectContaining({ table: "users", from: "user_id" })]);
  });

  it("rejects a game card outside the stat ranges", async () => {
    const failure = await db
      .insert(gameCards)
      .values({
        id: "gc_broken",
        kind: "creature",
        name: "Rusak",
        rarity: 9,
        cost: 3,
        contentVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    // Drizzle wraps the D1 error; the CHECK message sits on `cause`.
    const cause = failure instanceof Error ? failure.cause : undefined;
    const message = cause instanceof Error ? cause.message : "";
    expect(message).toMatch(/CHECK constraint failed/);
  });
});

describe("getOwnedCards", () => {
  it("returns copies per collection card for one user", async () => {
    await expect(getOwnedCards(db, "discord-1")).resolves.toEqual(
      expect.arrayContaining([
        { cardId: "jomok-mix-01-01", quantity: 3, holoQty: 1 },
        { cardId: "jomok-mix-01-02", quantity: 1, holoQty: 0 },
      ]),
    );
  });

  it("returns an empty list for an unknown user", async () => {
    await expect(getOwnedCards(db, "tidak-ada")).resolves.toEqual([]);
  });
});
