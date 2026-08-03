-- Persist only confirmed provider absences so a process restart does not
-- immediately replay expensive empty TradingView batches. Transport failures
-- are never written here; the runtime stores entries only after a successful
-- response explicitly confirms a missing field or series.
CREATE TABLE `provider_negative_cache` (
	`provider` text NOT NULL,
	`cache_kind` text NOT NULL,
	`provider_symbol` text NOT NULL,
	`metric_key` text DEFAULT '' NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`provider`,`cache_kind`,`provider_symbol`,`metric_key`)
);
--> statement-breakpoint
CREATE INDEX `provider_negative_cache_expiry_idx` ON `provider_negative_cache` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `provider_negative_cache_symbol_idx` ON `provider_negative_cache` (`provider`,`provider_symbol`);
