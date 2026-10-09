import assert from "node:assert/strict";
import test from "node:test";
import type { PortfolioAnalysis, PortfolioRecord } from "./portfolio";
import { orderEarningsEvents, selectPortfolioEventPositions, type SecurityEarningsEvent } from "./portfolio-events";

const portfolio: PortfolioRecord = { id: "test", name: "Test", baseCurrency: "USD", updatedAt: "2026-10-09", items: [], cashPositions: [], analysis: null };
const analysis: PortfolioAnalysis = {
  calculatedAt: "2026-10-09", allocationWeight: 100, cashWeight: 0, explicitCashWeight: 0, financingWeight: 0,
  netExposureWeight: 100, grossExposureWeight: 100, positionsCount: 12, directPositionsCount: 0, etfSleevesCount: 1,
  top10Concentration: 90, positions: [], sectors: [], sources: [],
};

test("events track the largest underlying equity exposures, including shorts and grouped quote references", () => {
  const positions = Array.from({ length: 12 }, (_, index) => ({
    securityId: `security-${index}`, ticker: `S${index}`, name: `Stock ${index}`, sector: "Tech", assetClass: "Equity",
    country: "US", weight: index === 0 ? -30 : index, contributions: [],
    ...(index === 0 ? { quoteSecurityId: "dominant-listing", quoteTicker: "ADR" } : {}),
  }));
  positions.push({ securityId: "bond", ticker: "BOND", name: "Bond", sector: "Other", assetClass: "Fixed Income", country: "US", weight: 90, contributions: [] });
  const result = selectPortfolioEventPositions({ ...portfolio, analysis: { ...analysis, positions } });
  assert.equal(result.length, 10);
  assert.deepEqual(result[0], { securityId: "dominant-listing", ticker: "ADR", name: "Stock 0", weight: -30 });
  assert.equal(result[1].securityId, "security-11");
  assert.ok(!result.some((position) => position.securityId === "security-1"));
  assert.ok(!result.some((position) => position.securityId === "bond"));
});

test("missing analysis falls back to direct stocks and merges duplicate issuer references", () => {
  const result = selectPortfolioEventPositions({ ...portfolio, items: [
    { id: "etf", kind: "etf", referenceId: "fund", ticker: "FUND", name: "Fund", allocationWeight: 80 },
    { id: "first", kind: "security", referenceId: "stock", ticker: "STK", name: "Stock", allocationWeight: 7 },
    { id: "second", kind: "security", referenceId: "stock", ticker: "STK", name: "Stock", allocationWeight: 3 },
    { id: "zero", kind: "security", referenceId: "zero", ticker: "ZERO", name: "Empty", allocationWeight: 0 },
  ] });
  assert.deepEqual(result, [{ securityId: "stock", ticker: "STK", name: "Stock", weight: 10 }]);
});

test("the calendar defaults to ten stocks and can track the top thirty", () => {
  const record = { ...portfolio, items: Array.from({ length: 35 }, (_, index) => ({
    id: `item-${index}`, kind: "security" as const, referenceId: `stock-${index}`,
    ticker: `S${index}`, name: `Stock ${index}`, allocationWeight: index + 1,
  })) };
  assert.equal(selectPortfolioEventPositions(record).length, 10);
  const expanded = selectPortfolioEventPositions(record, 30);
  assert.equal(expanded.length, 30);
  assert.equal(expanded[0].securityId, "stock-34");
  assert.equal(expanded[29].securityId, "stock-5");
  assert.equal(selectPortfolioEventPositions(record, 100).length, 30);
});

test("events are chronological, with unavailable dates last and stable ordering on the same day", () => {
  const event = (ticker: string, reportDate: string | null): SecurityEarningsEvent => ({
    securityId: ticker, ticker, name: ticker, reportDate, exchangeTimezone: "UTC", capturedAt: null, sourceStatus: "cached",
  });
  const input = [event("Z", "2026-11-10"), event("NONE", null), event("B", "2026-10-20"), event("A", "2026-10-20")];
  assert.deepEqual(orderEarningsEvents(input).map((row) => row.ticker), ["A", "B", "Z", "NONE"]);
  assert.equal(input[0].ticker, "Z");
});
