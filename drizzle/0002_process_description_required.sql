PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_grammar_processes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system_id` integer NOT NULL,
	`name` text,
	`description` text NOT NULL,
	`raw_expression` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_grammar_processes`("id", "system_id", "name", "description", "raw_expression", "position") SELECT "id", "system_id", "name", coalesce("description", ''), "raw_expression", "position" FROM `grammar_processes`;--> statement-breakpoint
DROP TABLE `grammar_processes`;--> statement-breakpoint
ALTER TABLE `__new_grammar_processes` RENAME TO `grammar_processes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;