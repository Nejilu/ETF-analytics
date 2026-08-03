import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMissingEstimateSeriesCache,
  clearMissingSourceMetricCache,
  estimateSeriesCacheKey,
  estimateSeriesMissingState,
  rememberAvailableEstimateSeries,
  rememberAvailableSourceMetric,
  rememberMissingEstimateSeries,
  rememberMissingSourceMetric,
  sourceMetricCacheKey,
  sourceMetricMissingState,
} from "./provider-negative-cache";

test("isolates missing estimate coverage and exposes expiration once", () => {
  clearMissingEstimateSeriesCache();
  const first = estimateSeriesCacheKey("/tmp/one.sqlite", "NSE:RELIANCE");
  const second = estimateSeriesCacheKey("/tmp/two.sqlite", "NSE:RELIANCE");
  rememberMissingEstimateSeries(first, 60_000, 1_000);
  assert.equal(estimateSeriesMissingState(first, 30_000), "fresh");
  assert.equal(estimateSeriesMissingState(second, 30_000), "absent");
  assert.equal(estimateSeriesMissingState(first, 61_001), "expired");
  assert.equal(estimateSeriesMissingState(first, 61_001), "absent");
});

test("clears a negative estimate result when a series becomes available", () => {
  clearMissingEstimateSeriesCache();
  const key = estimateSeriesCacheKey("/tmp/one.sqlite", "NASDAQ:MSFT");
  rememberMissingEstimateSeries(key, 60_000, 1_000);
  rememberAvailableEstimateSeries(key);
  assert.equal(estimateSeriesMissingState(key, 2_000), "absent");
});

test("isolates missing Screener fields by database, symbol and metric", () => {
  clearMissingSourceMetricCache();
  const priceBook = sourceMetricCacheKey("/tmp/one.sqlite", "NSE:RELIANCE", "price_to_book");
  const returnOnEquity = sourceMetricCacheKey("/tmp/one.sqlite", "NSE:RELIANCE", "return_on_equity");
  const otherDatabase = sourceMetricCacheKey("/tmp/two.sqlite", "NSE:RELIANCE", "price_to_book");
  rememberMissingSourceMetric(priceBook, 60_000, 1_000);
  assert.equal(sourceMetricMissingState(priceBook, 30_000), "fresh");
  assert.equal(sourceMetricMissingState(returnOnEquity, 30_000), "absent");
  assert.equal(sourceMetricMissingState(otherDatabase, 30_000), "absent");
  assert.equal(sourceMetricMissingState(priceBook, 61_001), "expired");
  assert.equal(sourceMetricMissingState(priceBook, 61_001), "absent");
});

test("clears a missing Screener field when the provider returns it", () => {
  clearMissingSourceMetricCache();
  const key = sourceMetricCacheKey("/tmp/one.sqlite", "NASDAQ:MSFT", "price_to_sales");
  rememberMissingSourceMetric(key, 60_000, 1_000);
  rememberAvailableSourceMetric(key);
  assert.equal(sourceMetricMissingState(key, 2_000), "absent");
});

test("renews a bounded negative entry before eviction", () => {
  clearMissingEstimateSeriesCache();
  const keys = Array.from({ length: 5_000 }, (_, index) =>
    estimateSeriesCacheKey("/tmp/bounded.sqlite", `NASDAQ:TEST${index}`),
  );
  for (const key of keys) rememberMissingEstimateSeries(key, 60_000, 1_000);

  rememberMissingEstimateSeries(keys[0], 60_000, 2_000);
  rememberMissingEstimateSeries(
    estimateSeriesCacheKey("/tmp/bounded.sqlite", "NASDAQ:EXTRA"),
    60_000,
    2_000,
  );

  assert.equal(estimateSeriesMissingState(keys[0], 3_000), "fresh");
  assert.equal(estimateSeriesMissingState(keys[1], 3_000), "absent");
});
