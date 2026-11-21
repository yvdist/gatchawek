CREATE TABLE `game_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`source_card_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`rarity` integer NOT NULL,
	`cost` integer NOT NULL,
	`atk` integer,
	`hp` integer,
	`class` text,
	`series` text DEFAULT 'netral' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`abilities` text DEFAULT '[]' NOT NULL,
	`ability_name` text,
	`ability_text` text,
	`flavor_text` text,
	`modes` text DEFAULT '["duel","ffa","raid"]' NOT NULL,
	`art_key` text,
	`frame_variant` text DEFAULT 'default' NOT NULL,
	`content_version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "game_cards_rarity_range" CHECK("game_cards"."rarity" BETWEEN 1 AND 5),
	CONSTRAINT "game_cards_cost_range" CHECK("game_cards"."cost" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`cards` text NOT NULL,
	`is_starter` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`format` text NOT NULL,
	`room_code` text,
	`seed` text NOT NULL,
	`engine_version` text NOT NULL,
	`content_version` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`result` text
);
--> statement-breakpoint
CREATE TABLE `match_players` (
	`match_id` text NOT NULL,
	`user_id` text,
	`seat` integer NOT NULL,
	`placement` integer,
	`rating_before` integer,
	`rating_after` integer,
	PRIMARY KEY(`match_id`, `seat`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ratings` (
	`user_id` text NOT NULL,
	`mode` text NOT NULL,
	`season` integer DEFAULT 1 NOT NULL,
	`elo` integer DEFAULT 1000 NOT NULL,
	`games` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `mode`, `season`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer DEFAULT 1 NOT NULL,
	`ref` text,
	`source_match_id` text,
	`created_at` integer NOT NULL,
	`claimed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bosses` (
	`id` text PRIMARY KEY NOT NULL,
	`game_card_id` text NOT NULL,
	`base_hp` integer NOT NULL,
	`hp_per_player` integer NOT NULL,
	`phases` text NOT NULL,
	`rewards` text NOT NULL,
	FOREIGN KEY (`game_card_id`) REFERENCES `game_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decks_user_idx` ON `decks` (`user_id`);
--> statement-breakpoint
CREATE INDEX `game_cards_status_idx` ON `game_cards` (`status`,`kind`,`rarity`);
--> statement-breakpoint
CREATE INDEX `rewards_unclaimed_idx` ON `rewards` (`user_id`,`claimed_at`);
