CREATE TABLE `inject_queue` (
	`message_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`author_id` text,
	`submitted_at` integer NOT NULL,
	`message_url` text NOT NULL,
	`nama` text,
	`member_id` text,
	`pool` text,
	`grup` text,
	`rarity` text,
	`label` text,
	`sumber` text,
	`image_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`errors` text,
	`reviewed_by` text,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `inject_queue_status_idx` ON `inject_queue` (`status`,`submitted_at`);