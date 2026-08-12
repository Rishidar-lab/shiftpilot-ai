CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`role` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_id`),
	CONSTRAINT "no_self_dependency" CHECK("task_dependencies"."task_id" != "task_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`estimated_minutes` integer,
	`deadline_at` text,
	`deadline_source` text NOT NULL,
	`explicit_urgency` text NOT NULL,
	`status` text NOT NULL,
	`block_reason` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
