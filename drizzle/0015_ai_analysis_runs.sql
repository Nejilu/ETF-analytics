CREATE TABLE `ai_analysis_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `environment_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `title` text NOT NULL,
  `request_json` text NOT NULL CHECK (json_valid(`request_json`)),
  `pending_message_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
