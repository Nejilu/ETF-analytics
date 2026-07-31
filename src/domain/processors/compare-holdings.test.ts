import assert from "node:assert/strict";
import test from "node:test";

import type { Holding, HoldingsSnapshot } from "../etf";
import { compareHoldings } from "./compare-holdings";

function snapshot(ticker: string, holdings: Holding[]): HoldingsSnapshot {
  return {
    etf: {
      id: `${ticker.toLowerCase()}-test`,
      ticker,
      name: ticker,
      benchmarkId: "test",
      isin: `TEST-${ticker}`,
      wrapper: "UCITS",
      domicile: "Test",
      exchange: "Test",
      tradingCurrency: "USD",
      distributionPolicy: "Accumulating",
      ter: 0,
      productUrl: "https://example.com",
      holdingsUrl: "https://example.com/holdings.csv",
    },
    asOf: "2026-07-31",
    fetchedAt: "2026-07-31T00:00:00.000Z",
    sourceStatus: "cached",
    sourceUrl: "https://example.com/holdings.csv",
    cacheTtlHours: 24,
    holdings,
  };
}

function holding(
  securityId: string,
  ticker: string,
  weight: number,
): Holding {
  return {
    securityId,
    ticker,
    name: ticker,
    sector: "Test",
    assetClass: "Equity",
    country: "Test",
    weight,
  };
}

test("calculates overlap before rounding individual positions", () => {
  const left = Array.from({ length: 300 }, (_, index) =>
    holding(`S${index}`, `L${index}`, 1 / 3),
  );
  const right = Array.from({ length: 300 }, (_, index) =>
    holding(`S${index}`, `R${index}`, 1 / 3),
  );

  const result = compareHoldings(snapshot("LEFT", left), snapshot("RIGHT", right));

  assert.equal(result.overlapWeight, 100);
  assert.equal(result.leftActiveWeight, 0);
  assert.equal(result.rightActiveWeight, 0);
});

test("normalises each implicit active sleeve to exactly 100%", () => {
  const result = compareHoldings(
    snapshot("LEFT", [
      holding("A", "A", 60),
      holding("B", "B", 40),
    ]),
    snapshot("RIGHT", [
      holding("A", "A", 20),
      holding("C", "C", 80),
    ]),
  );

  for (const sleeve of Object.values(result.implicitSleeves)) {
    const total = sleeve.positions.reduce(
      (sum, position) => sum + position.normalizedWeight,
      0,
    );
    assert.equal(total, 100);
  }
  assert.equal(result.implicitSleeves.left.positions[0].ticker, "A");
  assert.equal(result.implicitSleeves.right.positions[0].ticker, "C");
});
