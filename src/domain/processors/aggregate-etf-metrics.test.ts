import assert from "node:assert/strict";
import test from "node:test";

import type { Holding } from "@/domain/etf";
import type { SecurityMetricValues } from "@/domain/metrics";
import { aggregateEtfMetrics } from "./aggregate-etf-metrics";

function holding(securityId: string, weight: number, assetClass = "Equity"): Holding {
  return {
    securityId,
    ticker: securityId,
    name: securityId,
    sector: "Test",
    assetClass,
    country: "United States",
    weight,
  };
}

test("calculates a holding-weighted harmonic P/E on covered equity weight", () => {
  const values = new Map<string, SecurityMetricValues>([
    ["A", { securityId: "A", providerSymbol: "NASDAQ:A", values: { pe_estimate_window_4: 10 } }],
    ["B", { securityId: "B", providerSymbol: "NYSE:B", values: { pe_estimate_window_4: 20 } }],
  ]);
  const result = aggregateEtfMetrics([
    holding("A", 60),
    holding("B", 20),
    holding("MISSING", 20),
    holding("CASH", 5, "Cash"),
  ], values).find((metric) => metric.key === "pe_estimate_window_4");

  assert.ok(Math.abs((result?.value ?? 0) - 80 / 7) < 0.0001);
  assert.equal(result?.coverageWeight, 80);
  assert.equal(result?.coveredHoldings, 2);
  assert.equal(result?.totalHoldings, 3);
});
