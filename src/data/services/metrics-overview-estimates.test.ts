import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeEstimateSeriesCache,
} from "./metrics-overview-estimates";

const oldSeries = {
  providerSymbol: "NASDAQ:TEST",
  currency: "USD",
  price: 100,
  points: [],
};

const newSeries = {
  ...oldSeries,
  price: 110,
};

test("merges successful estimate writes without rereading SQLite", () => {
  const cached = new Map([
    ["security:test", { series: oldSeries, capturedAt: "2026-08-01T00:00:00.000Z" }],
  ]);

  const merged = mergeEstimateSeriesCache(
    cached,
    [{ securityId: "security:test", series: newSeries }],
    "2026-08-02T00:00:00.000Z",
  );

  assert.notEqual(merged, cached);
  assert.equal(cached.get("security:test")?.series.price, 100);
  assert.equal(merged.get("security:test")?.series.price, 110);
  assert.equal(merged.get("security:test")?.capturedAt, "2026-08-02T00:00:00.000Z");
});

test("does not allocate when no estimate write succeeded", () => {
  const cached = new Map();
  assert.equal(mergeEstimateSeriesCache(cached, [], "2026-08-02T00:00:00.000Z"), cached);
});
