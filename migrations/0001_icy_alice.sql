ALTER TABLE `cards` ADD `holo_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pulls` ADD `is_holo` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_cards` (
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`holo_qty` integer DEFAULT 0 NOT NULL,
	`first_obtained_at` integer NOT NULL,
	`last_obtained_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `card_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_cards_qty_nonneg" CHECK("__new_user_cards"."quantity" >= 0),
	CONSTRAINT "user_cards_holo_qty_nonneg" CHECK("__new_user_cards"."holo_qty" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_user_cards`("user_id", "card_id", "quantity", "holo_qty", "first_obtained_at", "last_obtained_at") SELECT "user_id", "card_id", "quantity", 0, "first_obtained_at", "last_obtained_at" FROM `user_cards`;--> statement-breakpoint
DROP TABLE `user_cards`;--> statement-breakpoint
ALTER TABLE `__new_user_cards` RENAME TO `user_cards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;