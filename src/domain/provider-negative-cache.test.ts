import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateSeriesNegativeCache,
  providerNegativeCacheKey,
  sourceMetricNegativeCache,
} from "./provider-negative-cache";

test("isolates missing estimate coverage and exposes expiration once", () => {
  estimateSeriesNegativeCache.clear();
  const first = providerNegativeCacheKey("/tmp/one.sqlite", "NSE:RELIANCE");
  const second = providerNegativeCacheKey("/tmp/two.sqlite", "NSE:RELIANCE");
  estimateSeriesNegativeCache.rememberMissing(first, 60_000, 1_000);
  assert.equal(estimateSeriesNegativeCache.state(first, 30_000), "fresh");
  assert.equal(estimateSeriesNegativeCache.state(second, 30_000), "absent");
  assert.equal(estimateSeriesNegativeCache.state(first, 61_001), "expired");
  assert.equal(estimateSeriesNegativeCache.state(first, 61_001), "absent");
});

test("clears a negative estimate result when a series becomes available", () => {
  estimateSeriesNegativeCache.clear();
  const key = providerNegativeCacheKey("/tmp/one.sqlite", "NASDAQ:MSFT");
  estimateSeriesNegativeCache.rememberMissing(key, 60_000, 1_000);
  estimateSeriesNegativeCache.rememberAvailable(key);
  assert.equal(estimateSeriesNegativeCache.state(key, 2_000), "absent");
});

test("isolates missing Screener fields by database, symbol and metric", () => {
  sourceMetricNegativeCache.clear();
  const priceBook = providerNegativeCacheKey("/tmp/one.sqlite", "NSE:RELIANCE", "price_to_book");
  const returnOnEquity = providerNegativeCacheKey("/tmp/one.sqlite", "NSE:RELIANCE", "return_on_equity");
  const otherDatabase = providerNegativeCacheKey("/tmp/two.sqlite", "NSE:RELIANCE", "price_to_book");
  sourceMetricNegativeCache.rememberMissing(priceBook, 60_000, 1_000);
  assert.equal(sourceMetricNegativeCache.state(priceBook, 30_000), "fresh");
  assert.equal(sourceMetricNegativeCache.state(returnOnEquity, 30_000), "absent");
  assert.equal(sourceMetricNegativeCache.state(otherDatabase, 30_000), "absent");
  assert.equal(sourceMetricNegativeCache.state(priceBook, 61_001), "expired");
  assert.equal(sourceMetricNegativeCache.state(priceBook, 61_001), "absent");
});

test("clears a missing Screener field when the provider returns it", () => {
  sourceMetricNegativeCache.clear();
  const key = providerNegativeCacheKey("/tmp/one.sqlite", "NASDAQ:MSFT", "price_to_sales");
  sourceMetricNegativeCache.rememberMissing(key, 60_000, 1_000);
  sourceMetricNegativeCache.rememberAvailable(key);
  assert.equal(sourceMetricNegativeCache.state(key, 2_000), "absent");
});

test("renews a bounded negative entry before eviction", () => {
  estimateSeriesNegativeCache.clear();
  const keys = Array.from({ length: 5_000 }, (_, index) =>
    providerNegativeCacheKey("/tmp/bounded.sqlite", `NASDAQ:TEST${index}`),
  );
  for (const key of keys) estimateSeriesNegativeCache.rememberMissing(key, 60_000, 1_000);

  estimateSeriesNegativeCache.rememberMissing(keys[0], 60_000, 2_000);
  estimateSeriesNegativeCache.rememberMissing(
    providerNegativeCacheKey("/tmp/bounded.sqlite", "NASDAQ:EXTRA"),
    60_000,
    2_000,
  );

  assert.equal(estimateSeriesNegativeCache.state(keys[0], 3_000), "fresh");
  assert.equal(estimateSeriesNegativeCache.state(keys[1], 3_000), "absent");
});
