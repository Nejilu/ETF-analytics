import assert from "node:assert/strict";
import test from "node:test";
import type { Holding } from "@/domain/etf";
import type { SecurityMetricValues } from "@/domain/metrics";
import type { StockMetricsMetadata } from "@/domain/stock-metrics";
import { buildStockMetricsResult } from "./stock-metrics-model";

const holding: Holding = {
  securityId: "security:test", ticker: "TEST", name: "Test company",
  sector: "Technology", country: "United States", assetClass: "Equity", weight: 25,
};
const metadata: StockMetricsMetadata = {
  source: "TradingView Screener + Estimates", sourceStatus: "cached", sourceWarnings: [],
  calculatedAt: "2026-10-07T10:00:00.000Z", fundamentalsCaptureWindow: null,
  estimatesCaptureWindow: null, cacheTtlHours: 24, definitions: [],
};
const observations: SecurityMetricValues = {
  securityId: holding.securityId, providerSymbol: "NASDAQ:TEST",
  values: { price_earnings_ttm: -12, dividend_yield: 0, market_cap: 1_000_000 },
  capturedAtByKey: { price_earnings_ttm: "2026-10-06T10:00:00.000Z" },
  estimateSeries: {
    providerSymbol: "NASDAQ:TEST", currency: "USD", price: 100,
    points: Array.from({ length: 8 }, (_, index) => ({
      fiscalPeriod: `Q${index + 1}`, estimate: index < 4 ? 1 : 2,
      isHistorical: index < 4, analystCount: 12, estimateDate: null,
    })),
  },
};

test("keeps stock observations and capture dates without ETF weighting or positive-ratio filters", () => {
  const result = buildStockMetricsResult(holding, observations, metadata);
  assert.equal(result.observations.values.price_earnings_ttm, -12);
  assert.equal(result.observations.values.dividend_yield, 0);
  assert.equal(result.observations.values.beta_1y, undefined);
  assert.equal(result.observations.capturedAtByKey?.price_earnings_ttm, "2026-10-06T10:00:00.000Z");
  assert.equal("weight" in result.security, false);
  assert.equal(result.definitions.length, 20);
  assert.equal(result.consensusWindows["4q"]?.pePath[0], 25);
  assert.equal(result.consensusWindows["4q"]?.pePath[4], 12.5);
  assert.equal(result.consensusWindows["4q"]?.growth, 100);
  assert.equal(result.consensusWindows["2q"]?.pePath.length, 7);
  assert.equal(result.consensusWindows["1q"]?.pePath.length, 8);
});

test("keeps loss-making EPS visible while leaving undefined P/E and growth empty", () => {
  const loss = structuredClone(observations);
  loss.estimateSeries!.points.forEach((point) => { point.estimate = -1; });
  const result = buildStockMetricsResult(holding, loss, metadata);
  assert.equal(result.observations.estimateSeries?.points[0].estimate, -1);
  assert.equal(result.consensusWindows["4q"]?.historicalAnnualizedEps, -4);
  assert.deepEqual(result.consensusWindows["4q"]?.pePath, [null, null, null, null, null]);
  assert.equal(result.consensusWindows["4q"]?.growth, null);
});

test("returns an explicit empty state with the mapping identity when observations are absent", () => {
  const result = buildStockMetricsResult(holding, undefined, { ...metadata, sourceStatus: "partial" }, "NASDAQ:TEST");
  assert.equal(result.sourceStatus, "partial");
  assert.equal(result.observations.providerSymbol, "NASDAQ:TEST");
  assert.deepEqual(result.observations.values, {});
  assert.deepEqual(result.consensusWindows, { "4q": null, "2q": null, "1q": null });
});
