CREATE TABLE `extraction_drafts` (
	`raw_input_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`index` integer NOT NULL,
	`disposition` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`estimated_minutes` integer,
	`deadline_at` text,
	`deadline_source` text NOT NULL,
	`explicit_urgency` text NOT NULL,
	`depends_on` text NOT NULL,
	`source_text` text NOT NULL,
	`reasons` text NOT NULL,
	PRIMARY KEY(`raw_input_id`, `draft_id`),
	FOREIGN KEY (`raw_input_id`) REFERENCES `raw_inputs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `raw_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`raw_text` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` text NOT NULL,
	`processed_at` text,
	`failure_kind` text,
	`failure_message` text,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
