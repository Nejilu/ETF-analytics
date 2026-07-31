CREATE TABLE `fx_rates` (
	`currency` text PRIMARY KEY NOT NULL,
	`provider_symbol` text NOT NULL,
	`rate_to_usd` real NOT NULL,
	`as_of` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_type` text NOT NULL,
	`asset_id` text NOT NULL,
	`provider_symbol` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`fx_to_usd` real NOT NULL,
	`price_usd` real NOT NULL,
	`as_of` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_prices_asset_uq` ON `market_prices` (`asset_type`,`asset_id`);--> statement-breakpoint
CREATE INDEX `market_prices_symbol_idx` ON `market_prices` (`provider_symbol`);--> statement-breakpoint
ALTER TABLE `etfs` ADD `price_symbol` text;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `quantity` real;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `input_mode` text;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `input_amount` real;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `initial_price_usd` real;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `initial_value_usd` real;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `price_symbol` text;--> statement-breakpoint
ALTER TABLE `portfolio_items` ADD `price_currency` text;