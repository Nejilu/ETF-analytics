import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUnrefreshedCachedItems,
  hasUnresolvedRefreshCandidates,
  isEstimateSeriesCompatible,
  isSourceMetricsCompatible,
  isValidEstimateSeries,
  metricsSourceStatus,
  needsEstimateSeriesRefresh,
  providerCandidatesMatch,
  resolvedProviderSymbol,
  shouldRetryUnresolvedMapping,
  shouldInvalidateProviderMapping,
  shouldPreserveUnresolvedMapping,
  shouldUseCachedSourceMetric,
} from "./metrics-cache";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

test("separates partial coverage from stale fallback data", () => {
  assert.equal(metricsSourceStatus(false, true, true), "partial");
  assert.equal(metricsSourceStatus(true, true, true), "stale");
  assert.equal(metricsSourceStatus(false, false, true), "live");
  assert.equal(metricsSourceStatus(false, false, false), "cached");
});

test("keeps a fresh estimate series when its provider symbol is unchanged", () => {
  assert.equal(
    needsEstimateSeriesRefresh(
      "NASDAQ:MSFT",
      "NASDAQ:MSFT",
      "2026-08-01T11:30:00.000Z",
      86_400,
      NOW,
    ),
    false,
  );
});

test("refreshes a fresh series when symbol resolution changes", () => {
  assert.equal(
    needsEstimateSeriesRefresh(
      "NYSE:MSFT",
      "NASDAQ:MSFT",
      "2026-08-01T11:59:00.000Z",
      86_400,
      NOW,
    ),
    true,
  );
});

test("refreshes a stale or malformed estimate series", () => {
  assert.equal(
    needsEstimateSeriesRefresh(
      "NASDAQ:MSFT",
      "NASDAQ:MSFT",
      "2026-07-30T12:00:00.000Z",
      86_400,
      NOW,
    ),
    true,
  );
  assert.equal(
    needsEstimateSeriesRefresh("NASDAQ:MSFT", "NASDAQ:MSFT", "invalid", 86_400, NOW),
    true,
  );
});

test("does not use an estimate series after its provider symbol changes", () => {
  assert.equal(isEstimateSeriesCompatible("NASDAQ:MSFT", "NASDAQ:MSFT"), true);
  assert.equal(isEstimateSeriesCompatible("NASDAQ:MSFT", "NYSE:MSFT"), false);
  assert.equal(isEstimateSeriesCompatible("NASDAQ:MSFT", undefined), false);
});

test("accepts a provider symbol only from a resolved mapping", () => {
  assert.equal(resolvedProviderSymbol({ status: "resolved", providerSymbol: "NASDAQ:MSFT" }), "NASDAQ:MSFT");
  assert.equal(resolvedProviderSymbol({ status: "resolved", providerSymbol: "  NASDAQ:MSFT  " }), "NASDAQ:MSFT");
  assert.equal(resolvedProviderSymbol({ status: "unresolved", providerSymbol: "NASDAQ:MSFT" }), undefined);
  assert.equal(resolvedProviderSymbol({ status: "resolved", providerSymbol: null }), undefined);
});

test("refreshes cached Screener metrics when their provider symbol changes", () => {
  assert.equal(isSourceMetricsCompatible("NASDAQ:MSFT", "NASDAQ:MSFT"), true);
  assert.equal(isSourceMetricsCompatible("NYSE:MSFT", "NASDAQ:MSFT"), false);
  assert.equal(isSourceMetricsCompatible("NASDAQ:MSFT", undefined), false);
});

test("does not aggregate a source field during its fresh negative-cache window", () => {
  assert.equal(shouldUseCachedSourceMetric("NASDAQ:MSFT", "NASDAQ:MSFT", false), true);
  assert.equal(shouldUseCachedSourceMetric("NASDAQ:MSFT", "NASDAQ:MSFT", true), false);
  assert.equal(shouldUseCachedSourceMetric("NYSE:MSFT", "NASDAQ:MSFT", false), false);
  assert.equal(shouldUseCachedSourceMetric("NASDAQ:MSFT", undefined, false), false);
});

test("detects cached items left behind by a partial provider response", () => {
  assert.equal(
    hasUnrefreshedCachedItems(
      ["A", "B"],
      new Set(["A"]),
      new Set(["A", "B"]),
    ),
    true,
  );
  assert.equal(
    hasUnrefreshedCachedItems(
      ["A", "B"],
      new Set(["A"]),
      new Set(["A"]),
    ),
    false,
  );
});

test("marks a refresh as unresolved when no provider candidate exists", () => {
  assert.equal(
    hasUnresolvedRefreshCandidates(
      ["A", "B"],
      new Map([["A", []], ["B", ["NASDAQ:B"]]]),
    ),
    true,
  );
  assert.equal(
    hasUnresolvedRefreshCandidates(
      ["B"],
      new Map([["B", ["NASDAQ:B"]]]),
    ),
    false,
  );
});

test("retries an unresolved mapping when its candidate set changes", () => {
  const metadata = { candidates: ["BMV:WALMEX*"] };
  assert.equal(providerCandidatesMatch(metadata, ["BMV:WALMEX*"]), true);
  assert.equal(providerCandidatesMatch(metadata, ["BMV:WALMEX*", "BMV:WALMEX"]), false);
  assert.equal(providerCandidatesMatch(null, ["NASDAQ:TEST"]), false);
  assert.equal(shouldRetryUnresolvedMapping(
    "unresolved",
    "2026-08-01T11:59:00.000Z",
    metadata,
    ["BMV:WALMEX*", "BMV:WALMEX"],
    86_400,
    NOW,
  ), true);
});

test("retries an unchanged unresolved mapping after its retry TTL", () => {
  const metadata = { candidates: ["NASDAQ:TEST"] };
  assert.equal(shouldRetryUnresolvedMapping(
    "unresolved",
    "2026-08-01T11:59:00.000Z",
    metadata,
    ["NASDAQ:TEST"],
    86_400,
    NOW,
  ), false);
  assert.equal(shouldRetryUnresolvedMapping(
    "unresolved",
    "2026-07-31T11:59:00.000Z",
    metadata,
    ["NASDAQ:TEST"],
    86_400,
    NOW,
  ), true);
});

test("preserves unresolved candidate metadata while a fresh cooldown skips the provider call", () => {
  assert.equal(shouldPreserveUnresolvedMapping(
    "unresolved",
    { candidates: ["BMV:UNKNOWN"] },
    [],
  ), true);
  assert.equal(shouldPreserveUnresolvedMapping(
    "unresolved",
    { candidates: ["BMV:UNKNOWN"] },
    ["BMV:UNKNOWN"],
  ), false);
  assert.equal(shouldPreserveUnresolvedMapping(
    "resolved",
    { candidates: ["BMV:UNKNOWN"] },
    [],
  ), false);
});

test("clears only missing or candidate-conflicting provider mappings", () => {
  assert.equal(shouldInvalidateProviderMapping(undefined, false), true);
  assert.equal(shouldInvalidateProviderMapping("NASDAQ:TEST", false), false);
  assert.equal(shouldInvalidateProviderMapping("NASDAQ:TEST", true), true);
});

function validSeries() {
  return {
    providerSymbol: "NASDAQ:TEST",
    currency: "USD",
    price: 100,
    points: Array.from({ length: 8 }, (_, index) => ({
      fiscalPeriod: `2026-Q${index + 1}`,
      estimate: index + 1,
      isHistorical: index < 4,
      estimateDate: null,
      analystCount: 10,
    })),
  };
}

test("rejects malformed persisted estimate series", () => {
  const series = validSeries();
  assert.equal(isValidEstimateSeries(series), true);
  assert.equal(isValidEstimateSeries({ ...series, price: 0 }), false);
  assert.equal(isValidEstimateSeries({
    ...series,
    points: series.points.map((point, index) => index === 2
      ? { ...point, estimate: Number.NaN }
      : point),
  }), false);
  assert.equal(isValidEstimateSeries({
    ...series,
    points: series.points.slice(0, 7),
  }), false);
  assert.equal(isValidEstimateSeries({
    ...series,
    points: series.points.map((point) => ({ ...point, isHistorical: false })),
  }), false);
  assert.equal(isValidEstimateSeries({
    ...series,
    points: series.points.map((point, index) => index === 7
      ? { ...point, fiscalPeriod: series.points[0].fiscalPeriod }
      : point),
  }), false);
  assert.equal(isValidEstimateSeries({
    ...series,
    points: series.points.map((point, index) => index === 7
      ? { ...point, estimateDate: "not-a-date" }
      : point),
  }), false);
});
