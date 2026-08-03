-- Remove consensus series that can never be consumed by the strict runtime validator.
-- The provider once returned duplicate fiscal periods in an eight-point payload;
-- keeping such rows only bloats the cache because loadLatestEstimateSeries ignores them.
-- Invalid JSON is deliberately left untouched so a malformed upstream payload cannot
-- make this migration fail; it remains quarantined by the application validator.
DELETE FROM `metric_observations`
WHERE `metric_definition_id` = 'security:eps_estimate_series:v1'
  AND `entity_type` = 'security'
  AND CASE
    WHEN json_valid(`value_json`) = 0 THEN 0
    WHEN json_type(`value_json`, '$.points') <> 'array' THEN 0
    ELSE EXISTS (
      SELECT 1
      FROM json_each(`metric_observations`.`value_json`, '$.points') AS first_point
      JOIN json_each(`metric_observations`.`value_json`, '$.points') AS second_point
        ON first_point.key < second_point.key
       AND json_extract(first_point.value, '$.fiscalPeriod') =
           json_extract(second_point.value, '$.fiscalPeriod')
    )
  END = 1;
