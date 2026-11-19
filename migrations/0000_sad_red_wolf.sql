CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`group_id` text NOT NULL,
	`member_id` text NOT NULL,
	`serial` integer NOT NULL,
	`photo_no` integer NOT NULL,
	`rarity` text NOT NULL,
	`image_file` text NOT NULL,
	`source_page_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_pool_serial_uq` ON `cards` (`pool_id`,`serial`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_member_photo_uq` ON `cards` (`member_id`,`photo_no`);--> statement-breakpoint
CREATE INDEX `cards_gacha_idx` ON `cards` (`pool_id`,`enabled`,`rarity`);--> statement-breakpoint
CREATE INDEX `cards_group_idx` ON `cards` (`group_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`name` text NOT NULL,
	`badge` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `groups_pool_idx` ON `groups` (`pool_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`name_lower` text NOT NULL,
	`full_name` text,
	`photo_total` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_group_idx` ON `members` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `members_pool_name_idx` ON `members` (`pool_id`,`name_lower`);--> statement-breakpoint
CREATE TABLE `pools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`stamina_max` integer DEFAULT 10 NOT NULL,
	`regen_interval_sec` integer DEFAULT 1500 NOT NULL,
	`reset_cooldown_sec` integer DEFAULT 10800 NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pulls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`card_id` text NOT NULL,
	`new_member` integer NOT NULL,
	`new_card` integer NOT NULL,
	`pulled_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pulls_user_idx` ON `pulls` (`user_id`,`pulled_at`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`proposer_id` text NOT NULL,
	`target_id` text NOT NULL,
	`offer_card_id` text NOT NULL,
	`request_card_id` text NOT NULL,
	`status` text NOT NULL,
	`settle_token` text,
	`channel_id` text,
	`message_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`proposer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trades_proposer_idx` ON `trades` (`proposer_id`,`status`);--> statement-breakpoint
CREATE INDEX `trades_target_idx` ON `trades` (`target_id`,`status`);--> statement-breakpoint
CREATE TABLE `user_cards` (
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`first_obtained_at` integer NOT NULL,
	`last_obtained_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `card_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_cards_qty_nonneg" CHECK("user_cards"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE `user_pool_states` (
	`user_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`stamina` integer NOT NULL,
	`stamina_anchor_at` integer NOT NULL,
	`last_reset_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `pool_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
