-- A malformed value_json can fail during Drizzle's JSON decoding before the
-- TypeScript validator is reached. Estimate observations are derived cache data,
-- so invalid JSON or a missing points array is safer to discard than to expose to
-- every Metrics Overview read.
DELETE FROM `metric_observations`
WHERE `metric_definition_id` = 'security:eps_estimate_series:v1'
  AND `entity_type` = 'security'
  AND CASE
    WHEN json_valid(`value_json`) = 0 THEN 1
    WHEN json_type(`value_json`, '$.points') IS NULL THEN 1
    WHEN json_type(`value_json`, '$.points') <> 'array' THEN 1
    ELSE 0
  END = 1;
