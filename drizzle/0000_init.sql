CREATE TABLE `grammar_processes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system_id` integer NOT NULL,
	`name` text,
	`raw_expression` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `papers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`authors` text NOT NULL,
	`year` integer NOT NULL,
	`venue` text NOT NULL,
	`citation_key` text NOT NULL,
	`doi` text,
	`url` text,
	`abstract` text,
	`notes` text,
	`tags` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `papers_citation_key_unique` ON `papers` (`citation_key`);--> statement-breakpoint
CREATE TABLE `systems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`process_scope` text,
	`notes` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
