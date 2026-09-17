ALTER TABLE `user` ADD `session_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `access_level` text DEFAULT 'full' NOT NULL;
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `mailbox_id` text;
