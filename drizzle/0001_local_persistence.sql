PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_holdings` (
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
	FOREIGN KEY (`snapshot_id`) REFERENCES `holding_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_holdings`("snapshot_id", "security_id", "weight", "quantity", "market_value", "local_price", "currency", "source_ticker", "source_row_json") SELECT "snapshot_id", "security_id", "weight", "quantity", "market_value", "local_price", "currency", "source_ticker", "source_row_json" FROM `holdings`;--> statement-breakpoint
DROP TABLE `holdings`;--> statement-breakpoint
ALTER TABLE `__new_holdings` RENAME TO `holdings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `holdings_security_idx` ON `holdings` (`security_id`);--> statement-breakpoint
ALTER TABLE `benchmarks` ADD `description` text;--> statement-breakpoint
ALTER TABLE `etfs` ADD `product_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `etfs` ADD `holdings_url` text DEFAULT '' NOT NULL;
