import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import { users } from "./schema.js";

/**
 * Game tables (spec 02 §2). Additive only: the legacy gacha tables in
 * `schema.ts` are never altered here. Listed separately in `drizzle.config.ts`
 * so one `drizzle-kit generate` owns both halves of the same database.
 *
 * Deviation (Decision Log, Fase 0): the spec's `users` table is NOT created:
 * `users` already exists (Discord id PK) and must not be touched, so game
 * identity lives in `game_profiles` and every `user_id` points at `users.id`.
 */

export const GAME_CARD_KINDS = ["creature", "spell", "token", "boss"] as const;
export type GameCardKind = (typeof GAME_CARD_KINDS)[number];

export const GAME_CARD_CLASSES = [
  "striker",
  "tank",
  "support",
  "trickster",
  "wildcard",
] as const;
export type GameCardClass = (typeof GAME_CARD_CLASSES)[number];

export const GAME_CARD_STATUSES = ["draft", "approved", "retired"] as const;

export const gameCards = sqliteTable(
  "game_cards",
  {
    id: text("id").primaryKey(),
    /** Collection card id (`cards.id`, e.g. `jomok-mix-01-01`); null for spell/token/boss. */
    sourceCardId: text("source_card_id"),
    kind: text("kind", { enum: GAME_CARD_KINDS }).notNull(),
    name: text("name").notNull(),
    rarity: integer("rarity").notNull(),
    cost: integer("cost").notNull(),
    atk: integer("atk"),
    hp: integer("hp"),
    class: text("class", { enum: GAME_CARD_CLASSES }),
    series: text("series").notNull().default("netral"),
    keywords: text("keywords").notNull().default("[]"),
    abilities: text("abilities").notNull().default("[]"),
    abilityName: text("ability_name"),
    abilityText: text("ability_text"),
    flavorText: text("flavor_text"),
    modes: text("modes").notNull().default('["duel","ffa","raid"]'),
    artKey: text("art_key"),
    frameVariant: text("frame_variant").notNull().default("default"),
    contentVersion: integer("content_version").notNull(),
    status: text("status", { enum: GAME_CARD_STATUSES })
      .notNull()
      .default("draft"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("game_cards_status_idx").on(t.status, t.kind, t.rarity),
    check("game_cards_rarity_range", sql`${t.rarity} BETWEEN 1 AND 5`),
    check("game_cards_cost_range", sql`${t.cost} BETWEEN 0 AND 10`),
  ],
);

export const gameProfiles = sqliteTable("game_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
});

export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** JSON: [{"id":"gc_x","n":2}] */
    cards: text("cards").notNull(),
    isStarter: integer("is_starter", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("decks_user_idx").on(t.userId)],
);

export const GAME_MODES = ["duel", "ffa", "raid"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: GAME_MODES }).notNull(),
  /** ranked | casual | blind | practice | raid_normal | ... */
  format: text("format").notNull(),
  roomCode: text("room_code"),
  seed: text("seed").notNull(),
  engineVersion: text("engine_version").notNull(),
  contentVersion: integer("content_version").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  /** JSON summary: winners, rounds, boss id. */
  result: text("result"),
});

export const matchPlayers = sqliteTable(
  "match_players",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    /** null = bot seat */
    userId: text("user_id").references(() => users.id),
    seat: integer("seat").notNull(),
    placement: integer("placement"),
    ratingBefore: integer("rating_before"),
    ratingAfter: integer("rating_after"),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.seat] })],
);

export const ratings = sqliteTable(
  "ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    mode: text("mode", { enum: GAME_MODES }).notNull(),
    season: integer("season").notNull().default(1),
    elo: integer("elo").notNull().default(1000),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.mode, t.season] })],
);

export const REWARD_KINDS = ["exp", "gacha_ticket", "card_copy", "cosmetic"] as const;

export const rewards = sqliteTable(
  "rewards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: REWARD_KINDS }).notNull(),
    amount: integer("amount").notNull().default(1),
    /** game card id or cosmetic id */
    ref: text("ref"),
    sourceMatchId: text("source_match_id").references(() => matches.id),
    createdAt: integer("created_at").notNull(),
    claimedAt: integer("claimed_at"),
  },
  (t) => [index("rewards_unclaimed_idx").on(t.userId, t.claimedAt)],
);

export const bosses = sqliteTable("bosses", {
  id: text("id").primaryKey(),
  gameCardId: text("game_card_id")
    .notNull()
    .references(() => gameCards.id),
  baseHp: integer("base_hp").notNull(),
  hpPerPlayer: integer("hp_per_player").notNull(),
  /** JSON: BossPhase[] */
  phases: text("phases").notNull(),
  /** JSON reward table */
  rewards: text("rewards").notNull(),
});
