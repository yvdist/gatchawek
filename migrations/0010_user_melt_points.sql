CREATE TABLE `user_melt_points` (
	`user_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`points` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`user_id`, `pool_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON UPDATE no action ON DELETE no action
);
