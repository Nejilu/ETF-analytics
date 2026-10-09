import assert from "node:assert/strict";
import test from "node:test";

import type { EtfShareClass, Holding, HoldingsSnapshot } from "../etf";
import { holdingsCashDisplayPositions } from "../holdings-cash-display";
import { analyzeHoldings } from "./analyze-holdings";
import { calculateHoldingsDistortion } from "./calculate-holdings-distortion";
import { portfolioHoldingsValuation, portfolioPositionValueUsd } from "../portfolio-valuation";

function snapshot(
  id: string,
  ticker: string,
  holdings: Holding[],
): HoldingsSnapshot {
  return {
    etf: {
      id,
      ticker,
      name: ticker,
      benchmarkId: id,
      isin: id,
      wrapper: "US_1940_ACT",
      domicile: "United States",
      exchange: "NYSE Arca",
      tradingCurrency: "USD",
      distributionPolicy: "Distributing",
      ter: 0,
      productUrl: "https://example.com",
      holdingsUrl: "https://example.com/holdings.csv",
    } satisfies EtfShareClass,
    asOf: "2026-08-11",
    fetchedAt: "2026-08-12T08:00:00.000Z",
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
  assetClass = "Equity",
): Holding {
  return {
    securityId,
    ticker,
    name: `${ticker} Inc`,
    sector: "Technology",
    assetClass,
    country: "United States",
    weight,
  };
}

test("portfolio analysis keeps NAV amounts, shorts and leverage across weight and cash displays", () => {
  const target = snapshot("portfolio", "PORT", [
    holding("A", "A", 180),
    holding("B", "B", -30),
    holding("USD", "USD", -60, "Cash"),
    holding("EUR", "EUR", 10, "Cash"),
  ]);
  target.etf.fundType = "portfolio";
  target.portfolioValuation = portfolioHoldingsValuation(10000, [{
    id: "private-item-id", kind: "security", referenceId: "A", ticker: "A", name: "A",
    allocationWeight: 180, quantity: 90, currentValueUsd: 18000,
    inputAmount: 18000, initialValueUsd: 17000,
  }], [{ currency: "USD", amount: -6000, valueUsd: -6000 }, { currency: "EUR", amount: 900, valueUsd: 1000 }]);
  const result = analyzeHoldings(target, snapshot("acwi-us", "ACWI", [holding("A", "A", 100)]));
  assert.deepEqual(result.portfolioValuation, target.portfolioValuation);
  const a = result.positions.find((p) => p.ticker === "A")!;
  const b = result.positions.find((p) => p.ticker === "B")!;
  assert.equal(a.publishedWeight, 180);
  assert.equal(a.normalizedWeightExCash, 120);
  assert.equal(b.publishedWeight, -30);
  assert.equal(portfolioPositionValueUsd(a.publishedWeight, result.portfolioValuation!), 18000);
  assert.equal(portfolioPositionValueUsd(b.publishedWeight, result.portfolioValuation!), -3000);
  const combinedCash = holdingsCashDisplayPositions(result.positions, "combined").find((p) => p.isCash)!;
  assert.equal(portfolioPositionValueUsd(combinedCash.publishedWeight, result.portfolioValuation!), -5000);
  assert.equal(result.portfolioValuation!.cash[1].weight, 10);
  assert.equal(result.portfolioValuation!.items[0].quantity, 90);
  assert(!JSON.stringify(result.portfolioValuation).includes("private-item-id"));
  assert(!JSON.stringify(result.portfolioValuation).includes("initialValueUsd"));

  target.etf.fundType = "physical";
  assert.equal(analyzeHoldings(target, target).portfolioValuation, undefined);
});

test("returns zero when the ETF matches its ACWI-implied free-float weights", () => {
  const acwi = snapshot("acwi-us", "ACWI", [
    holding("A", "A", 60),
    holding("B", "B", 25),
    holding("C", "C", 15),
  ]);
  const result = analyzeHoldings(acwi, acwi);

  assert.equal(result.distortion.score, 0);
  assert.equal(result.marketCoverage.score, 0);
  assert.equal(result.distortion.coverageWeight, 100);
  assert.equal(result.distortion.coverageStatus, "complete");
  assert.equal(result.positions[0].distortionContribution, 0);
});

test("defaults to the largest 30 equities and excludes small-position artifacts", () => {
  const main = Array.from({ length: 30 }, (_, i) => holding(`MAIN:${i}`, `MAIN${i}`, 3));
  const tail = Array.from({ length: 20 }, (_, i) => holding(`TAIL:${i}`, `TAIL${i}`, 0.5));
  const target = snapshot("target", "TARGET", [...tail, ...main]);
  const acwi = snapshot("acwi-us", "ACWI", [...main.map((h) => ({ ...h, weight: 1 })), ...tail.map((h) => ({ ...h, weight: 3.5 }))]);
  const result = analyzeHoldings(target, acwi);
  assert.equal(result.distortion.mode, "top-holdings");
  assert.equal(result.distortion.topCount, 30);
  assert.equal(result.distortion.eligibleHoldings, 30);
  assert.equal(result.distortion.selectedWeight, 90);
  assert.equal(result.distortion.score, 0);
  assert.equal(result.allHoldingsDistortion.score, 60);
  assert.equal(result.marketCoverage.score, 60);
  const fullTop = calculateHoldingsDistortion(result.positions, result.distortionReferencePositions, result.distortion, "top-holdings", 50);
  assert.equal(fullTop.distortion.score, result.allHoldingsDistortion.score);
  assert.equal(fullTop.positions.length, 50);
});

test("recalculates a top subset against only its ACWI weights and leaves canonical holdings unchanged", () => {
  const result = analyzeHoldings(snapshot("target", "TARGET", [holding("C", "C", 10), holding("B", "B", 30), holding("A", "A", 60)]), snapshot("acwi-us", "ACWI", [holding("A", "A", 20), holding("B", "B", 20), holding("C", "C", 60)]));
  const original = structuredClone(result.positions);
  const top = calculateHoldingsDistortion(result.positions, result.distortionReferencePositions, result.distortion, "top-holdings", 2);
  assert.equal(top.distortion.topCount, 2);
  assert.equal(top.distortion.selectedWeight, 90);
  assert.equal(top.distortion.score, 16.666666);
  assert.equal(top.positions.find((p) => p.ticker === "A")?.actualWeight, 66.666667);
  assert.equal(top.positions.find((p) => p.ticker === "A")?.counterfactualWeight, 50);
  assert.deepEqual(result.positions, original);
  assert.equal(calculateHoldingsDistortion(result.positions, result.distortionReferencePositions, result.distortion, "top-holdings", 100).distortion.topCount, 3);
});

test("market coverage retains the full ACWI even when the portfolio holds only one constituent", () => {
  const result = analyzeHoldings(snapshot("target", "TARGET", [holding("A", "A", 100)]), snapshot("acwi-us", "ACWI", [holding("A", "A", 20), holding("B", "B", 30), holding("C", "C", 50)]));
  assert.equal(result.distortion.score, 0);
  assert.equal(result.allHoldingsDistortion.score, 0);
  assert.equal(result.marketCoverage.score, 80);
  const market = calculateHoldingsDistortion(result.positions, result.distortionReferencePositions, result.distortion, "market-coverage");
  assert.equal(market.distortion.referenceHoldings, 3);
  assert.equal(market.positions.reduce((sum, p) => sum + (p.distortionContribution ?? 0), 0), market.distortion.score);
  assert.equal(market.positions.find((p) => p.ticker === "B")?.distortionStatus, "not-held");
  assert.equal(market.positions.find((p) => p.ticker === "B")?.actualWeight, 0);
  assert.equal(market.positions.find((p) => p.ticker === "B")?.counterfactualWeight, 30);
});

test("market coverage includes equities outside ACWI, including a completely disjoint portfolio", () => {
  const acwi = snapshot("acwi-us", "ACWI", [holding("A", "A", 50), holding("B", "B", 50)]);
  const result = analyzeHoldings(snapshot("target", "TARGET", [holding("A", "A", 50), holding("OUTSIDE", "OUT", 50)]), acwi);
  assert.equal(result.distortion.score, 0);
  assert.equal(result.marketCoverage.score, 50);
  const market = calculateHoldingsDistortion(result.positions, result.distortionReferencePositions, result.distortion, "market-coverage");
  assert.equal(market.positions.find((p) => p.ticker === "OUT")?.counterfactualWeight, 0);
  assert.equal(market.positions.find((p) => p.ticker === "OUT")?.distortionContribution, 25);
  const disjoint = analyzeHoldings(snapshot("target", "TARGET", [holding("OUTSIDE", "OUT", 100)]), acwi);
  assert.equal(disjoint.distortion.score, null);
  assert.equal(disjoint.allHoldingsDistortion.score, null);
  assert.equal(disjoint.marketCoverage.score, 100);
});

test("top selection precedes ACWI matching and excludes cash and nonpositive equity exposures", () => {
  const target = snapshot("portfolio", "PORT", [holding("USD", "USD", 100, "Cash"), holding("OUT", "OUT", 60), holding("A", "A", 30), holding("B", "B", 10), holding("SHORT", "SHORT", -100)]);
  target.etf.fundType = "portfolio";
  const result = analyzeHoldings(target, snapshot("acwi-us", "ACWI", [holding("A", "A", 50), holding("B", "B", 50)]));
  const top = calculateHoldingsDistortion(result.positions, result.distortionReferencePositions, result.distortion, "top-holdings", 2);
  assert.deepEqual(top.positions.map((p) => p.ticker).sort(), ["A", "OUT"]);
  assert.equal(top.distortion.coveredHoldings, 1);
  assert.equal(top.distortion.missingHoldings, 1);
  assert.equal(top.distortion.coverageWeight, 33.333333);
  assert.equal(top.distortion.score, 0);
});

test("empty equity or ACWI universes do not produce a score", () => {
  const cash = snapshot("target", "TARGET", [holding("USD", "USD", 100, "Cash")]);
  const acwi = snapshot("acwi-us", "ACWI", [holding("A", "A", 100)]);
  const result = analyzeHoldings(cash, acwi);
  assert.equal(result.distortion.topCount, 0);
  assert.equal(result.distortion.score, null);
  assert.equal(result.marketCoverage.score, null);
  assert.equal(analyzeHoldings(acwi, cash).marketCoverage.score, null);
});

test("matches the NDX distortion formula and reconciles position contributions", () => {
  const target = snapshot("target", "TARGET", [
    holding("A", "A", 50),
    holding("B", "B", 30),
    holding("C", "C", 20),
  ]);
  const acwi = snapshot("acwi-us", "ACWI", [
    holding("A", "A", 60),
    holding("B", "B", 25),
    holding("C", "C", 15),
  ]);
  const result = analyzeHoldings(target, acwi);

  assert.equal(result.distortion.score, 10);
  assert.equal(
    result.positions.reduce(
      (sum, position) => sum + (position.distortionContribution ?? 0),
      0,
    ),
    10,
  );
  assert.equal(
    result.positions.find((position) => position.ticker === "A")?.weightDelta,
    -10,
  );
});

test("reports ACWI coverage and scores only the common equity universe", () => {
  const target = snapshot("target", "TARGET", [
    holding("A", "A", 50),
    holding("B", "B", 30),
    holding("MISSING", "MISS", 15),
    holding("CASH", "USD", 5, "Cash"),
  ]);
  const acwi = snapshot("acwi-us", "ACWI", [
    holding("A", "A", 70),
    holding("B", "B", 30),
  ]);
  const result = analyzeHoldings(target, acwi);

  assert.equal(result.distortion.coverageWeight, 84.210526);
  assert.equal(result.distortion.coverageStatus, "partial");
  assert.equal(result.distortion.coveredHoldings, 2);
  assert.equal(result.distortion.missingHoldings, 1);
  assert.equal(
    result.positions.find((position) => position.ticker === "MISS")
      ?.distortionStatus,
    "not-in-acwi",
  );
  assert.equal(
    result.positions.find((position) => position.ticker === "USD")
      ?.distortionStatus,
    "non-equity",
  );
  assert.equal(result.cashHoldingsCount, 1);
  assert.equal(result.cashWeight, 5);
  assert.equal(
    result.positions.find((position) => position.ticker === "USD")?.isCash,
    true,
  );
  assert.equal(
    result.positions.find((position) => position.ticker === "A")
      ?.normalizedWeightExCash,
    52.631579,
  );
});

test("groups cash, money-market funds and unclassified cash rows as cash", () => {
  const target = snapshot("target", "TARGET", [
    holding("A", "A", 96),
    { ...holding("USD", "USD", 1, "Cash"), name: "USD CASH" },
    { ...holding("MMF", "MMF", 2, "Money Market"), name: "Treasury fund" },
    { ...holding("EUR", "EUR", 1, "Unclassified"), name: "EUR CASH" },
  ]);
  const acwi = snapshot("acwi-us", "ACWI", [holding("A", "A", 100)]);

  const result = analyzeHoldings(target, acwi);

  assert.equal(result.cashHoldingsCount, 3);
  assert.equal(result.cashWeight, 4);
  assert.equal(
    result.positions.find((position) => position.ticker === "A")
      ?.normalizedWeightExCash,
    100,
  );
  assert.equal(
    result.positions.find((position) => position.ticker === "MMF")?.isCash,
    true,
  );
});

test("preserves borrowed cash and net asset weights while normalizing securities separately", () => {
  const target = snapshot("target", "TARGET", [
    holding("A", "A", 120),
    holding("CASH:USD", "USD", 10, "Cash"),
    holding("CASH:EUR", "EUR", -30, "Cash"),
  ]);
  const acwi = snapshot("acwi-us", "ACWI", [holding("A", "A", 100)]);
  const result = analyzeHoldings(target, acwi);
  assert.equal(result.cashHoldingsCount, 2);
  assert.equal(result.cashWeight, -20);
  assert.equal(result.positions.find((p) => p.securityId === "CASH:EUR")?.publishedWeight, -30);
  assert.equal(result.positions.find((p) => p.securityId === "CASH:EUR")?.normalizedWeightExCash, null);
  assert.equal(result.positions.find((p) => p.securityId === "A")?.publishedWeight, 120);
  assert.equal(result.positions.find((p) => p.securityId === "A")?.normalizedWeightExCash, 100);
  assert.equal(result.positions.reduce((sum, p) => sum + p.publishedWeight, 0), 100);
});

test("preserves offsetting cash currencies even when net cash is zero", () => {
  const target = snapshot("target", "TARGET", [
    holding("A", "A", 100),
    holding("CASH:USD", "USD", 20, "Cash"),
    holding("CASH:EUR", "EUR", -20, "Cash"),
  ]);
  const result = analyzeHoldings(target, target);
  assert.equal(result.cashHoldingsCount, 2);
  assert.equal(result.cashWeight, 0);
  assert.equal(result.positions.find((p) => p.securityId === "CASH:EUR")?.publishedWeight, -20);
});


test("cash display grouping preserves signed totals and canonical positions", () => {
  for (const negativeCash of [-30, -10]) {
    const target = snapshot("target", "TARGET", [
      holding("A", "A", 90 - negativeCash),
      holding("CASH:USD", "USD", 10, "Cash"),
      holding("CASH:EUR", "EUR", negativeCash, "Cash"),
    ]);
    const analysis = analyzeHoldings(target, target);
    const original = structuredClone(analysis.positions);
    const combined = holdingsCashDisplayPositions(analysis.positions, "combined");
    const separate = holdingsCashDisplayPositions(analysis.positions, "positions");
    assert.equal(combined.length, 2);
    assert.equal(combined.find((p) => p.isCash)?.publishedWeight, 10 + negativeCash);
    assert.equal(combined.reduce((sum, p) => sum + p.publishedWeight, 0), 100);
    assert.equal(separate.length, 3);
    assert.equal(separate.find((p) => p.securityId === "CASH:EUR")?.publishedWeight, negativeCash);
    assert.deepEqual(analysis.positions, original);
    assert.deepEqual(combined.filter((p) => !p.isCash), original.filter((p) => !p.isCash));
  }
});
