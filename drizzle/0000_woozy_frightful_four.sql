CREATE TABLE `benchmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`region` text,
	`methodology_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmarks_name_provider_uq` ON `benchmarks` (`name`,`provider`);--> statement-breakpoint
CREATE TABLE `etfs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`isin` text NOT NULL,
	`name` text NOT NULL,
	`issuer` text NOT NULL,
	`benchmark_id` text NOT NULL,
	`wrapper` text NOT NULL,
	`domicile` text NOT NULL,
	`exchange` text NOT NULL,
	`trading_currency` text NOT NULL,
	`distribution_policy` text NOT NULL,
	`ter` real,
	`active` integer DEFAULT true NOT NULL,
	`metadata_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`benchmark_id`) REFERENCES `benchmarks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `etfs_ticker_exchange_uq` ON `etfs` (`ticker`,`exchange`);--> statement-breakpoint
CREATE UNIQUE INDEX `etfs_isin_uq` ON `etfs` (`isin`);--> statement-breakpoint
CREATE INDEX `etfs_benchmark_idx` ON `etfs` (`benchmark_id`);--> statement-breakpoint
CREATE TABLE `holding_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`etf_id` text NOT NULL,
	`as_of` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source_url` text NOT NULL,
	`source_hash` text,
	`source_status` text NOT NULL,
	`total_weight` real NOT NULL,
	`row_count` integer NOT NULL,
	`raw_metadata_json` text,
	FOREIGN KEY (`etf_id`) REFERENCES `etfs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_snapshots_etf_asof_hash_uq` ON `holding_snapshots` (`etf_id`,`as_of`,`source_hash`);--> statement-breakpoint
CREATE INDEX `holding_snapshots_latest_idx` ON `holding_snapshots` (`etf_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`snapshot_id` text NOT NULL,
	`security_id` text NOT NULL,
	`weight` real NOT NULL,
	`quantity` real,
	`market_value` real,
	`local_price` real,
	`currency` text,
	`source_ticker` text,
	`source_row_json` text,
	PRIMARY KEY(`snapshot_id`, `security_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `holding_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `holdings_security_idx` ON `holdings` (`security_id`);--> statement-breakpoint
CREATE TABLE `metric_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`entity_type` text NOT NULL,
	`value_type` text NOT NULL,
	`unit` text,
	`frequency` text,
	`version` integer DEFAULT 1 NOT NULL,
	`formula_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_definitions_key_version_uq` ON `metric_definitions` (`key`,`version`);--> statement-breakpoint
CREATE TABLE `metric_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`metric_definition_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`as_of` text NOT NULL,
	`value_number` real,
	`value_text` text,
	`value_json` text,
	`source` text,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`metric_definition_id`) REFERENCES `metric_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_observations_natural_uq` ON `metric_observations` (`metric_definition_id`,`entity_type`,`entity_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `metric_observations_entity_idx` ON `metric_observations` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text,
	`primary_ticker` text,
	`name` text NOT NULL,
	`asset_class` text,
	`sector` text,
	`industry` text,
	`country` text,
	`currency` text,
	`identifiers_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_isin_uq` ON `securities` (`isin`);--> statement-breakpoint
CREATE INDEX `securities_ticker_idx` ON `securities` (`primary_ticker`);