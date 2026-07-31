CREATE TABLE `portfolio_items` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`etf_id` text,
	`security_id` text,
	`allocation_weight` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`etf_id`) REFERENCES `etfs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `portfolio_items_portfolio_idx` ON `portfolio_items` (`portfolio_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_items_etf_uq` ON `portfolio_items` (`portfolio_id`,`etf_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_items_security_uq` ON `portfolio_items` (`portfolio_id`,`security_id`);--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
