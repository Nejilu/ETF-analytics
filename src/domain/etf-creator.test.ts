import assert from "node:assert/strict";
import test from "node:test";

import type { Holding } from "./etf";
import {
  applyCreatorManualCuration,
  creatorHoldingMultiplier,
  combineCreatorSubsets,
  deriveDynamicCreatorHoldings,
  dynamicCreatorDescription,
  filterCreatorHoldings,
  normalizeCreatorHoldings,
} from "./etf-creator";

const holdings: Holding[] = [
  {
    securityId: "A",
    ticker: "AAA",
    name: "Alpha",
    sector: "Technology",
    assetClass: "Equity",
    country: "United States",
    weight: 60,
  },
  {
    securityId: "B",
    ticker: "BBB",
    name: "Beta",
    sector: "Financials",
    assetClass: "Equity",
    country: "France",
    weight: 30,
  },
  {
    securityId: "C",
    ticker: "CCC",
    name: "Gamma",
    sector: "Technology",
    assetClass: "Equity",
    country: "France",
    weight: 10,
  },
];

test("filters the ACWI universe by geography, sector and overlap", () => {
  const result = filterCreatorHoldings(
    holdings,
    {
      countryMode: "include",
      countries: ["France"],
      sectorMode: "exclude",
      sectors: ["Financials"],
      overlapMode: "include",
      overlapEtfId: "peer",
    },
    new Set(["A", "C"]),
  );

  assert.deepEqual(result.map((holding) => holding.securityId), ["C"]);
});

test("renormalizes retained free-float weights to exactly 100", () => {
  const result = normalizeCreatorHoldings([holdings[1], holdings[2]]);

  assert.equal(result.reduce((sum, holding) => sum + holding.weight, 0), 100);
  assert.equal(result[0].securityId, "B");
  assert.equal(result[0].weight, 75);
  assert.equal(result[1].weight, 25);
});

test("equal weighting ignores source weights, including zero weights", () => {
  const source = [holdings[0], holdings[1], { ...holdings[2], weight: 0 }];
  const result = normalizeCreatorHoldings(source, "equal");

  assert.equal(result.length, 3);
  for (const holding of result) {
    assert.ok(Math.abs(holding.weight - 100 / 3) < 1e-12);
    assert.equal(holding.marketValue, undefined);
  }
  assert.ok(Math.abs(result.reduce((sum, holding) => sum + holding.weight, 0) - 100) < 1e-12);
  assert.equal(source[2].weight, 0);
  assert.deepEqual(normalizeCreatorHoldings([], "equal"), []);
  assert.equal(normalizeCreatorHoldings([source[2]], "equal")[0].weight, 100);
});

test("equal weighting redistributes missing constituents among available selections", () => {
  const result = deriveDynamicCreatorHoldings(holdings, [
    { securityId: "A", ticker: "AAA" },
    { securityId: "A", ticker: "AAA" },
    { securityId: "C", ticker: "CCC" },
    { securityId: "MISSING", ticker: "MISS" },
  ], "equal");

  assert.deepEqual(result.holdings.map(({ securityId, weight }) => [securityId, weight]), [
    ["A", 50], ["C", 50],
  ]);
  assert.deepEqual(result.missingSecurities, [{ securityId: "MISSING", ticker: "MISS" }]);
});

test("manual curation can add filtered-out holdings and remove rule matches", () => {
  const automatic = [holdings[0], holdings[2]];
  const result = applyCreatorManualCuration(
    holdings,
    automatic,
    new Set(["B"]),
    new Set(["A"]),
  );

  assert.deepEqual(result.map((holding) => holding.securityId), ["B", "C"]);
});

test("dynamic creator holdings exclude missing selections and renormalize on read", () => {
  const result = deriveDynamicCreatorHoldings(
    [holdings[0], { ...holdings[1], weight: 40 }],
    [
      { securityId: "A", ticker: "AAA" },
      { securityId: "MISSING", ticker: "MISS" },
      { securityId: "B", ticker: "BBB" },
    ],
  );

  assert.deepEqual(
    result.holdings.map(({ securityId, weight }) => [securityId, weight]),
    [["A", 60], ["B", 40]],
  );
  assert.deepEqual(result.missingSecurities, [
    { securityId: "MISSING", ticker: "MISS" },
  ]);
});

test("dynamic creator descriptions explain on-read weighting", () => {
  assert.equal(
    dynamicCreatorDescription("My rules.", 12, "ACWI"),
    "My rules. 12 ACWI constituents selected; available source free-float weights are recalculated and normalized to 100% on every read.",
  );
  assert.equal(
    dynamicCreatorDescription("My rules.", 12, "ACWI", "equal"),
    "My rules. 12 ACWI constituents selected; available constituents are equally weighted to a total of 100% on every read.",
  );
});

test("sector multipliers tilt the full universe without filtering it", () => {
  const criteria = {
    countryMode: "include" as const, countries: [],
    sectorMode: "include" as const, sectors: [], overlapMode: "none" as const,
    weightMultipliers: { sectors: { Technology: 2 } },
  };
  const selected = filterCreatorHoldings(holdings, criteria);
  assert.equal(selected.length, 3);
  const result = normalizeCreatorHoldings(selected, "free-float", criteria.weightMultipliers);
  const weights = new Map(result.map((holding) => [holding.securityId, holding.weight]));
  assert.ok(Math.abs(weights.get("A")! - 120 / 170 * 100) < 1e-12);
  assert.ok(Math.abs(weights.get("B")! - 30 / 170 * 100) < 1e-12);
  assert.ok(Math.abs(weights.get("C")! - 20 / 170 * 100) < 1e-12);
  assert.deepEqual(holdings.map((holding) => holding.weight), [60, 30, 10]);
});

test("country, sector, overlap and individual multipliers compound before normalization", () => {
  const multipliers = {
    countries: { "United States": 0.5, France: 2 }, sectors: { Technology: 2 },
    securities: { A: 0.5, C: 0.5 }, overlap: 3, nonOverlap: 0.5,
  };
  const overlap = new Set(["A"]);
  assert.equal(creatorHoldingMultiplier(holdings[0], multipliers, overlap), 1.5);
  const result = normalizeCreatorHoldings(holdings, "free-float", multipliers, overlap);
  const weights = new Map(result.map((holding) => [holding.securityId, holding.weight]));
  assert.ok(Math.abs(weights.get("A")! - 90 / 130 * 100) < 1e-12);
  assert.ok(Math.abs(weights.get("B")! - 30 / 130 * 100) < 1e-12);
  assert.ok(Math.abs(weights.get("C")! - 10 / 130 * 100) < 1e-12);
  assert.ok(Math.abs(result.reduce((sum, holding) => sum + holding.weight, 0) - 100) < 1e-12);
});

test("multipliers can tilt an equal base and retain zero-weight selections", () => {
  const result = normalizeCreatorHoldings(holdings, "equal", { securities: { A: 2, B: 0, C: 0.5 } });
  assert.deepEqual(result.map(({ securityId, weight }) => [securityId, weight]), [
    ["A", 80], ["C", 20], ["B", 0],
  ]);
  assert.deepEqual(normalizeCreatorHoldings(holdings, "free-float", {
    securities: { A: 0, B: 0, C: 0 },
  }), []);
});

test("dynamic multiplier weights use current classifications and exclude missing selections", () => {
  const selected = holdings.map(({ securityId, ticker }) => ({ securityId, ticker }));
  const result = deriveDynamicCreatorHoldings([
    { ...holdings[0], sector: "Financials", weight: 50 }, holdings[1],
  ], selected, "free-float", { sectors: { Technology: 2 } });
  assert.deepEqual(result.holdings.map((holding) => holding.weight), [62.5, 37.5]);
  assert.deepEqual(result.missingSecurities, [{ securityId: "C", ticker: "CCC" }]);
});

test("subset targets are preserved and shared security contributions are added", () => {
  const result = combineCreatorSubsets([
    { id: "growth", name: "Growth", allocationWeight: 60, holdings: normalizeCreatorHoldings([holdings[0], holdings[1]]) },
    { id: "balance", name: "Balance", allocationWeight: 40, holdings: normalizeCreatorHoldings([holdings[1], holdings[2]], "equal") },
  ]);
  assert.equal(result.allocationTotal, 100);
  assert.deepEqual(result.emptySubsetNames, []);
  assert.deepEqual(result.holdings.map(({ securityId, weight }) => [securityId, weight]), [["A", 40], ["B", 40], ["C", 20]]);
});

test("incomplete or unavailable subsets are not silently reallocated to other subsets", () => {
  const result = combineCreatorSubsets([
    { id: "one", name: "One", allocationWeight: 40, holdings: normalizeCreatorHoldings([holdings[0]]) },
    { id: "two", name: "Two", allocationWeight: 30, holdings: [] },
    { id: "zero", name: "Zero", allocationWeight: 0, holdings: [] },
  ]);
  assert.equal(result.allocationTotal, 70);
  assert.deepEqual(result.emptySubsetNames, ["Two"]);
  assert.equal(result.holdings[0].weight, 40);
});
