import assert from "node:assert/strict";
import test from "node:test";

import type { HoldingsSnapshot } from "../etf";
import type { PortfolioItem, PortfolioSecurity } from "../portfolio";
import { analyzePortfolio } from "./analyze-portfolio";

const apple: PortfolioSecurity = {
  securityId: "US0378331005",
  ticker: "AAPL",
  name: "Apple",
  sector: "Information Technology",
  assetClass: "Equity",
  country: "United States",
};

const microsoft: PortfolioSecurity = {
  securityId: "US5949181045",
  ticker: "MSFT",
  name: "Microsoft",
  sector: "Information Technology",
  assetClass: "Equity",
  country: "United States",
};

const snapshot = {
  etf: { ticker: "ACWI" },
  asOf: "2026-07-30",
  sourceStatus: "cached",
  holdings: [
    { ...apple, weight: 60 },
    { ...microsoft, weight: 40 },
  ],
} as HoldingsSnapshot;

test("aggregates direct positions with their ETF look-through exposure", () => {
  const items: PortfolioItem[] = [
    {
      id: "etf",
      kind: "etf",
      referenceId: "acwi-us",
      ticker: "ACWI",
      name: "iShares MSCI ACWI ETF",
      allocationWeight: 50,
    },
    {
      id: "direct",
      kind: "security",
      referenceId: apple.securityId,
      ticker: apple.ticker,
      name: apple.name,
      allocationWeight: 20,
    },
  ];

  const result = analyzePortfolio({
    items,
    etfSnapshots: new Map([["ACWI", snapshot]]),
    directSecurities: new Map([[apple.securityId, apple]]),
    calculatedAt: "2026-07-31T00:00:00.000Z",
  });

  assert.equal(result.positions[0].ticker, "AAPL");
  assert.equal(result.positions[0].weight, 50);
  assert.equal(result.positions[0].contributions.length, 2);
  assert.equal(result.positions[1].weight, 20);
  assert.equal(result.cashWeight, 30);
  assert.equal(result.top10Concentration, 70);
});

test("normalises small source weight drift inside each ETF sleeve", () => {
  const driftingSnapshot = {
    ...snapshot,
    holdings: [
      { ...apple, weight: 49 },
      { ...microsoft, weight: 50 },
    ],
  } as HoldingsSnapshot;

  const result = analyzePortfolio({
    items: [
      {
        id: "etf",
        kind: "etf",
        referenceId: "acwi-us",
        ticker: "ACWI",
        name: "iShares MSCI ACWI ETF",
        allocationWeight: 100,
      },
    ],
    etfSnapshots: new Map([["ACWI", driftingSnapshot]]),
    directSecurities: new Map(),
  });

  assert.equal(
    Math.round(
      result.positions.reduce((sum, position) => sum + position.weight, 0),
    ),
    100,
  );
});

test("recalculates a saved component definition from updated ETF holdings", () => {
  const item: PortfolioItem = {
    id: "etf",
    kind: "etf",
    referenceId: "acwi-us",
    ticker: "ACWI",
    name: "iShares MSCI ACWI ETF",
    allocationWeight: 100,
  };
  const updatedSnapshot = {
    ...snapshot,
    asOf: "2026-07-31",
    holdings: [
      { ...apple, weight: 20 },
      { ...microsoft, weight: 80 },
    ],
  } as HoldingsSnapshot;

  const original = analyzePortfolio({
    items: [item],
    etfSnapshots: new Map([["ACWI", snapshot]]),
    directSecurities: new Map(),
  });
  const updated = analyzePortfolio({
    items: [item],
    etfSnapshots: new Map([["ACWI", updatedSnapshot]]),
    directSecurities: new Map(),
  });

  assert.equal(original.positions.find((position) => position.ticker === "AAPL")?.weight, 60);
  assert.equal(updated.positions.find((position) => position.ticker === "AAPL")?.weight, 20);
  assert.equal(updated.positions[0].ticker, "MSFT");
});

test("rejects allocations above 100%", () => {
  assert.throws(
    () =>
      analyzePortfolio({
        items: [
          {
            id: "direct",
            kind: "security",
            referenceId: apple.securityId,
            ticker: apple.ticker,
            name: apple.name,
            allocationWeight: 101,
          },
        ],
        etfSnapshots: new Map(),
        directSecurities: new Map([[apple.securityId, apple]]),
      }),
    /cannot exceed 100%/,
  );
});
