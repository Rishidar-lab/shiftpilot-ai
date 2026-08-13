PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_raw_inputs` (
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
	`report_warnings` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_raw_inputs`("id", "shift_id", "raw_text", "status", "provider", "prompt_version", "created_at", "processed_at", "failure_kind", "failure_message", "report_warnings") SELECT "id", "shift_id", "raw_text", "status", "provider", "prompt_version", "created_at", "processed_at", "failure_kind", "failure_message", "report_warnings" FROM `raw_inputs`;--> statement-breakpoint
DROP TABLE `raw_inputs`;--> statement-breakpoint
ALTER TABLE `__new_raw_inputs` RENAME TO `raw_inputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `extraction_drafts` ADD `deadline_hint` text;--> statement-breakpoint
ALTER TABLE `extraction_drafts` ADD `rejection_reason` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `timezone` text DEFAULT 'UTC' NOT NULL;