CREATE TABLE `battles` (
	`id` text PRIMARY KEY NOT NULL,
	`challenger_id` text NOT NULL,
	`target_id` text NOT NULL,
	`challenger_card_id` text NOT NULL,
	`target_card_id` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`winner_id` text,
	`challenger_score` integer,
	`target_score` integer,
	`challenger_crit` integer DEFAULT false NOT NULL,
	`target_crit` integer DEFAULT false NOT NULL,
	`settle_token` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`challenger_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challenger_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `battles_challenger_idx` ON `battles` (`challenger_id`,`status`);--> statement-breakpoint
CREATE INDEX `battles_target_idx` ON `battles` (`target_id`,`status`);