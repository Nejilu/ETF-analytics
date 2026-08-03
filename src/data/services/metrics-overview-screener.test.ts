import assert from "node:assert/strict";
import test from "node:test";

import {
  candidatesConfirmedMissing,
  hasSufficientMappingEvidence,
  mergeCachedSourceMetrics,
  mappingConfidence,
  prepareScreenerRefresh,
  reconcileSourceMetricCoverageGap,
  refreshScreenerMetrics,
  selectBestScreenerMatch,
  transportFailedSecurityIds,
} from "./metrics-overview-screener";
import { SOURCE_METRIC_DEFINITIONS, type MetricKey } from "@/domain/metrics";
import type { CachedSecurityMetrics } from "@/db/repositories/metrics-repository";
import type { Holding } from "@/domain/etf";

test("distinguishes confirmed candidate absence from a failed provider batch", () => {
  assert.equal(
    candidatesConfirmedMissing(
      ["NASDAQ:MISSING"],
      new Set(["NASDAQ:MISSING"]),
      new Set(),
    ),
    true,
  );
  assert.equal(
    candidatesConfirmedMissing(
      ["NASDAQ:FAILED"],
      new Set(["NASDAQ:FAILED"]),
      new Set(["NASDAQ:FAILED"]),
    ),
    false,
  );
  assert.equal(candidatesConfirmedMissing([], new Set(), new Set()), true);
});

test("selects the highest name match and keeps candidate order on ties", async () => {
  const observations = new Map([
    ["NASDAQ:TEST", {
      symbol: "NASDAQ:TEST",
      ticker: "TEST",
      description: "Test Holdings Inc",
      sector: "Technology",
      values: {},
    }],
    ["NASDAQ:TEST-A", {
      symbol: "NASDAQ:TEST-A",
      ticker: "TEST-A",
      description: "Test Holdings Inc Technology",
      sector: "Technology",
      values: {},
    }],
  ]);

  const match = selectBestScreenerMatch(
    "Test Holdings Technology",
    ["NASDAQ:TEST", "NASDAQ:TEST-A"],
    observations,
  );

  assert.equal(match?.observation.symbol, "NASDAQ:TEST-A");
  assert.equal(match?.position, 1);
});

test("returns no match when all candidates are absent", () => {
  assert.equal(selectBestScreenerMatch("Unknown", ["NASDAQ:MISSING"], new Map()), undefined);
});

test("marks only unresolved failed candidates as transport gaps", () => {
  const holdings = [
    { securityId: "resolved", ticker: "TEST", name: "Test", weight: 1 },
    { securityId: "failed", ticker: "FAIL", name: "Fail", weight: 1 },
    { securityId: "cached", ticker: "CACHE", name: "Cache", weight: 1 },
  ] as Holding[];
  const candidates = new Map<string, readonly string[]>([
    ["resolved", ["NASDAQ:FAIL", "NASDAQ:TEST"]],
    ["failed", ["NASDAQ:FAIL"]],
    ["cached", ["NASDAQ:FAIL"]],
  ]);
  assert.deepEqual(
    transportFailedSecurityIds(
      holdings,
      new Set(["resolved", "failed"]),
      candidates,
      new Set(["NASDAQ:FAIL"]),
      new Set(["resolved"]),
    ),
    ["failed"],
  );
});

test("clears a prior source coverage gap after a complete observation", () => {
  const coverageGaps = new Set(["security:test"]);

  reconcileSourceMetricCoverageGap(
    coverageGaps,
    "security:test",
    SOURCE_METRIC_DEFINITIONS.length,
  );
  assert.deepEqual([...coverageGaps], []);

  reconcileSourceMetricCoverageGap(coverageGaps, "security:test", 5);
  assert.deepEqual([...coverageGaps], ["security:test"]);
});

test("keeps confirmed source gaps partial when no refresh symbols remain", async () => {
  const result = await refreshScreenerMetrics({
    holdings: [],
    needsRefresh: new Set(),
    candidatesBySecurity: new Map(),
    requestedSymbols: [],
    providerSymbols: new Map(),
    cachedMetrics: new Map(),
    securityIds: [],
    missingSourceMetricTtlMs: 60_000,
    sourceMetricCoverageGaps: new Set(["security:test"]),
  });

  assert.equal(result.hasPartialCoverage, true);
  assert.deepEqual(result.warnings, ["screener-partial"]);
});

test("builds a mapping refresh plan from the holding and persisted provider state", () => {
  const plan = prepareScreenerRefresh({
    holdings: [{
      securityId: "security:aapl",
      ticker: "AAPL",
      name: "Apple Inc",
      sector: "Technology",
      assetClass: "Equity",
      country: "United States",
      exchange: "NASDAQ",
      weight: 1,
    }],
    providerSymbols: new Map(),
    cachedMetrics: new Map(),
    ttlSeconds: 86_400,
  });

  assert.deepEqual(plan.requestedSymbols, ["NASDAQ:AAPL"]);
  assert.deepEqual([...plan.needsRefresh], ["security:aapl"]);
  assert.equal(plan.hasUnresolvedCandidates, false);
  assert.deepEqual(plan.candidateDetailsBySecurity.get("security:aapl"), [{
    symbol: "NASDAQ:AAPL",
    provenance: "exact_exchange",
  }]);
});

test("does not keep a persisted symbol outside the current candidate set", () => {
  const plan = prepareScreenerRefresh({
    holdings: [{
      securityId: "security:aapl",
      ticker: "AAPL",
      name: "Apple Inc",
      sector: "Technology",
      assetClass: "Equity",
      country: "United States",
      exchange: "NASDAQ",
      weight: 1,
    }],
    providerSymbols: new Map([[
      "security:aapl",
      {
        securityId: "security:aapl",
        providerSymbol: "NYSE:AAPL",
        status: "resolved",
        lastVerifiedAt: "2026-08-01T00:00:00.000Z",
        metadata: null,
      },
    ]]),
    cachedMetrics: new Map(),
    ttlSeconds: 86_400,
  });

  assert.deepEqual(plan.candidatesBySecurity.get("security:aapl"), ["NASDAQ:AAPL"]);
  assert.deepEqual(plan.requestedSymbols, ["NASDAQ:AAPL"]);
});

test("keeps country fallbacks auditable and assigns a conservative confidence", () => {
  const holding = {
    securityId: "security:legacy",
    ticker: "LEGACY",
    name: "Legacy Holdings",
    sector: "Technology",
    assetClass: "Equity",
    country: "United States",
    weight: 1,
  };
  const matchingTicker = {
    symbol: "NASDAQ:LEGACY",
    ticker: "LEGACY",
    description: null,
    sector: null,
    values: {},
  };
  const unrelated = {
    ...matchingTicker,
    ticker: "OTHER",
    symbol: "NASDAQ:OTHER",
  };

  assert.equal(hasSufficientMappingEvidence(holding, matchingTicker, "country_fallback", 0), true);
  assert.equal(hasSufficientMappingEvidence(holding, unrelated, "country_fallback", 0), false);
  assert.equal(hasSufficientMappingEvidence(holding, unrelated, "confirmed_alias", 0), true);
  assert.equal(mappingConfidence("country_fallback", 0), 0.5);
  assert.equal(mappingConfidence("exact_exchange", 1), 1);
});

test("requires issuer evidence for an exact exchange ticker collision", () => {
  const holding = {
    securityId: "security:collision",
    ticker: "ORIGINAL",
    name: "Original Holdings",
    sector: "Technology",
    assetClass: "Equity",
    country: "United States",
    exchange: "NASDAQ",
    weight: 1,
  };
  const differentTicker = {
    symbol: "NASDAQ:OTHER",
    ticker: "OTHER",
    description: null,
    sector: null,
    values: {},
  };

  assert.equal(hasSufficientMappingEvidence(holding, differentTicker, "exact_exchange", 0), false);
  assert.equal(hasSufficientMappingEvidence(holding, { ...differentTicker, description: "Original Holdings Inc" }, "exact_exchange", 0.5), true);
  assert.equal(hasSufficientMappingEvidence(holding, { ...differentTicker, ticker: "ORIGINAL" }, "exact_exchange", 0), true);
  assert.equal(hasSufficientMappingEvidence(holding, differentTicker, "confirmed_alias", 0), true);
});

test("merges Screener writes without rereading cached metrics", () => {
  const cached = new Map<string, CachedSecurityMetrics>([[
    "security:test",
    {
      securityId: "security:test",
      providerSymbol: "NASDAQ:OLD",
      values: { price_to_book: 2, pe_estimate_window_4: 20 },
      capturedAt: "2026-08-01T00:00:00.000Z",
      observedKeys: new Set<MetricKey>(["price_to_book", "pe_estimate_window_4"]),
      sourceCapturedAtByKey: new Map<MetricKey, string>([
        ["price_to_book", "2026-08-01T00:00:00.000Z"],
      ]),
      sourceProviderSymbolByKey: new Map<MetricKey, string | null>([
        ["price_to_book", "NASDAQ:OLD"],
      ]),
    },
  ]]);

  const merged = mergeCachedSourceMetrics(
    cached,
    [{
      securityId: "security:test",
      providerSymbol: "NASDAQ:TEST",
      values: { price_to_book: 3.5 },
    }],
    "2026-08-02T00:00:00.000Z",
  );

  assert.notEqual(merged, cached);
  assert.equal(cached.get("security:test")?.values.price_to_book, 2);
  assert.equal(merged.get("security:test")?.values.price_to_book, 3.5);
  assert.equal(merged.get("security:test")?.values.pe_estimate_window_4, 20);
  assert.equal(merged.get("security:test")?.providerSymbol, "NASDAQ:TEST");
  assert.equal(
    merged.get("security:test")?.sourceProviderSymbolByKey.get("price_to_book"),
    "NASDAQ:TEST",
  );
});
