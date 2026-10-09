CREATE TABLE `portfolio_history_settings` (
  `portfolio_id` text PRIMARY KEY NOT NULL REFERENCES `portfolios` (`id`) ON DELETE CASCADE,
  `enabled` integer DEFAULT 1 NOT NULL,
  `last_attempt_at` text,
  `last_error` text
);
--> statement-breakpoint
CREATE TABLE `portfolio_value_snapshots` (
  `portfolio_id` text NOT NULL REFERENCES `portfolios` (`id`) ON DELETE CASCADE,
  `date` text NOT NULL,
  `captured_at` text NOT NULL,
  `value_usd` real NOT NULL,
  `value_eur` real NOT NULL,
  `eur_to_usd` real NOT NULL,
  `quotes_as_of` text NOT NULL,
  `fx_as_of` text NOT NULL,
  `reason` text NOT NULL,
  PRIMARY KEY (`portfolio_id`, `date`),
  CONSTRAINT `portfolio_snapshot_positive_values` CHECK (`value_usd` > 0 AND `value_eur` > 0 AND `eur_to_usd` > 0)
);
