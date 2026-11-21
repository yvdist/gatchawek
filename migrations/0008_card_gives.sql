CREATE TABLE `gives` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`giver_id` text NOT NULL,
	`target_id` text,
	`card_id` text NOT NULL,
	`status` text NOT NULL,
	`claimer_id` text,
	`settle_token` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`giver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gives_giver_idx` ON `gives` (`giver_id`,`status`);
--> statement-breakpoint
CREATE INDEX `gives_target_idx` ON `gives` (`target_id`,`status`);
