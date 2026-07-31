ALTER TABLE `etfs` ADD `fund_type` text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE `etfs` ADD `portfolio_id` text;--> statement-breakpoint
ALTER TABLE `etfs` ADD `description` text;