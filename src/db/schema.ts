import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const flag = (n: string) =>
  integer(n, { mode: "boolean" }).notNull().default(true);

export const RARITIES = [
  "common",
  "rare",
  "super_rare",
  "ultra_rare",
  "holo",
  "secret",
] as const;
export type Rarity = (typeof RARITIES)[number];

export const pools = sqliteTable("pools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  staminaMax: integer("stamina_max").notNull().default(10),
  regenIntervalSec: integer("regen_interval_sec").notNull().default(1500),
  resetCooldownSec: integer("reset_cooldown_sec").notNull().default(10800),
  memberCount: integer("member_count").notNull().default(0),
  enabled: flag("enabled"),
});

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id")
      .notNull()
      .references(() => pools.id),
    name: text("name").notNull(),
    badge: text("badge").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    memberCount: integer("member_count").notNull().default(0),
    enabled: flag("enabled"),
  },
  (t) => [index("groups_pool_idx").on(t.poolId, t.sortOrder)],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id")
      .notNull()
      .references(() => pools.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    name: text("name").notNull(),
    nameLower: text("name_lower").notNull(),
    fullName: text("full_name"),
    photoTotal: integer("photo_total").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: flag("enabled"),
  },
  (t) => [
    index("members_group_idx").on(t.groupId, t.sortOrder),
    index("members_pool_name_idx").on(t.poolId, t.nameLower),
  ],
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id")
      .notNull()
      .references(() => pools.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    serial: integer("serial").notNull(),
    photoNo: integer("photo_no").notNull(),
    rarity: text("rarity", { enum: RARITIES }).notNull(),
    photoLabel: text("photo_label"),
    imageFile: text("image_file").notNull(),
    sourcePageUrl: text("source_page_url"),
    enabled: flag("enabled"),
    holoEnabled: integer("holo_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Unix seconds of the last admin render request; null = never requested. */
    renderRequestedAt: integer("render_requested_at"),
  },
  (t) => [
    uniqueIndex("cards_pool_serial_uq").on(t.poolId, t.serial),
    uniqueIndex("cards_member_photo_uq").on(t.memberId, t.photoNo),
    index("cards_gacha_idx").on(t.poolId, t.enabled, t.rarity),
    index("cards_group_idx").on(t.groupId),
  ],
);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  exp: integer("exp").notNull().default(0),
});

/**
 * Community-inject queue: rows written by the scheduled ingest poll, reviewed
 * from a phone via /inject-review. Replaces the old data/submissions/*.json
 * files (local-only) so no laptop is needed in the loop.
 */
export const injectQueue = sqliteTable(
  "inject_queue",
  {
    messageId: text("message_id").primaryKey(),
    channelId: text("channel_id").notNull(),
    guildId: text("guild_id").notNull(),
    authorId: text("author_id"),
    submittedAt: integer("submitted_at").notNull(),
    messageUrl: text("message_url").notNull(),
    nama: text("nama"),
    memberId: text("member_id"),
    pool: text("pool"),
    grup: text("grup"),
    rarity: text("rarity", { enum: RARITIES }),
    label: text("label"),
    sumber: text("sumber"),
    imageUrl: text("image_url"),
    status: text("status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    errors: text("errors"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
  },
  (t) => [index("inject_queue_status_idx").on(t.status, t.submittedAt)],
);

export const userPoolStates = sqliteTable(
  "user_pool_states",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    poolId: text("pool_id")
      .notNull()
      .references(() => pools.id),
    stamina: integer("stamina").notNull(),
    staminaAnchorAt: integer("stamina_anchor_at").notNull(),
    lastResetAt: integer("last_reset_at"),
    version: integer("version").notNull().default(0),
    pityWish: integer("pity_wish").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.poolId] })],
);

/** Up to MAX_WISHES_PER_POOL wished cards per user per pool; row deleted on hit. */
export const wishes = sqliteTable(
  "wishes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    poolId: text("pool_id")
      .notNull()
      .references(() => pools.id),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.cardId] }),
    index("wishes_user_pool_idx").on(t.userId, t.poolId),
  ],
);

export const userCards = sqliteTable(
  "user_cards",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    quantity: integer("quantity").notNull(),
    holoQty: integer("holo_qty").notNull().default(0),
    firstObtainedAt: integer("first_obtained_at").notNull(),
    lastObtainedAt: integer("last_obtained_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.cardId] }),
    check("user_cards_qty_nonneg", sql`${t.quantity} >= 0`),
    check("user_cards_holo_qty_nonneg", sql`${t.holoQty} >= 0`),
  ],
);

export const trades = sqliteTable(
  "trades",
  {
    id: text("id").primaryKey(),
    proposerId: text("proposer_id")
      .notNull()
      .references(() => users.id),
    targetId: text("target_id")
      .notNull()
      .references(() => users.id),
    offerCardId: text("offer_card_id")
      .notNull()
      .references(() => cards.id),
    requestCardId: text("request_card_id")
      .notNull()
      .references(() => cards.id),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "cancelled", "failed"],
    }).notNull(),
    settleToken: text("settle_token"),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    index("trades_proposer_idx").on(t.proposerId, t.status),
    index("trades_target_idx").on(t.targetId, t.status),
  ],
);

export const pulls = sqliteTable(
  "pulls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    poolId: text("pool_id").notNull(),
    cardId: text("card_id").notNull(),
    newMember: integer("new_member", { mode: "boolean" }).notNull(),
    newCard: integer("new_card", { mode: "boolean" }).notNull(),
    isHolo: integer("is_holo", { mode: "boolean" }).notNull().default(false),
    pulledAt: integer("pulled_at").notNull(),
  },
  (t) => [index("pulls_user_idx").on(t.userId, t.pulledAt)],
);

export const battles = sqliteTable(
  "battles",
  {
    id: text("id").primaryKey(),
    challengerId: text("challenger_id")
      .notNull()
      .references(() => users.id),
    targetId: text("target_id")
      .notNull()
      .references(() => users.id),
    challengerCardId: text("challenger_card_id")
      .notNull()
      .references(() => cards.id),
    targetCardId: text("target_card_id").references(() => cards.id),
    mode: text("mode", { enum: ["casual", "wager"] }).notNull(),
    status: text("status", {
      enum: ["pending", "resolved", "declined", "cancelled", "failed"],
    }).notNull(),
    winnerId: text("winner_id"),
    challengerScore: integer("challenger_score"),
    targetScore: integer("target_score"),
    challengerCrit: integer("challenger_crit", { mode: "boolean" })
      .notNull()
      .default(false),
    targetCrit: integer("target_crit", { mode: "boolean" })
      .notNull()
      .default(false),
    settleToken: text("settle_token"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    index("battles_challenger_idx").on(t.challengerId, t.status),
    index("battles_target_idx").on(t.targetId, t.status),
  ],
);

export const gives = sqliteTable(
  "gives",
  {
    id: text("id").primaryKey(),
    mode: text("mode", { enum: ["public", "direct"] }).notNull(),
    giverId: text("giver_id")
      .notNull()
      .references(() => users.id),
    targetId: text("target_id").references(() => users.id),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    status: text("status", {
      enum: ["open", "claimed", "rejected", "cancelled", "expired", "failed"],
    }).notNull(),
    claimerId: text("claimer_id"),
    settleToken: text("settle_token"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    index("gives_giver_idx").on(t.giverId, t.status),
    index("gives_target_idx").on(t.targetId, t.status),
  ],
);

export const albumTokens = sqliteTable(
  "album_tokens",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    poolId: text("pool_id"),
    settleToken: text("settle_token"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [index("album_tokens_user_idx").on(t.userId, t.createdAt)],
);
