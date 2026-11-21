ALTER TABLE `user_pool_states` RENAME COLUMN `pity_secret` TO `pity_wish`;--> statement-breakpoint
UPDATE `user_pool_states` SET `pity_wish` = 0;--> statement-breakpoint
CREATE TABLE `wishes` (
	`user_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`card_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `card_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wishes_user_pool_idx` ON `wishes` (`user_id`,`pool_id`);
