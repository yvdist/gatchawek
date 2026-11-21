CREATE TABLE `album_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`pool_id` text,
	`settle_token` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `album_tokens_user_idx` ON `album_tokens` (`user_id`,`created_at`);
