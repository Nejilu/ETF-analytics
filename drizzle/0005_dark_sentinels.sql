CREATE TABLE `security_provider_symbols` (
	`provider` text NOT NULL,
	`security_id` text NOT NULL,
	`provider_symbol` text,
	`status` text NOT NULL,
	`confidence` real,
	`last_verified_at` text NOT NULL,
	`metadata_json` text,
	PRIMARY KEY(`provider`, `security_id`),
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `security_provider_symbols_symbol_idx` ON `security_provider_symbols` (`provider`,`provider_symbol`);