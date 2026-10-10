import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { closeDatabase, getSqlite } from "@/db/client";
import {
  ensureMetricDefinitions, saveEstimateSeriesBatch, saveProviderSymbolsBatch,
  saveSecurityMetricsBatch,
} from "@/db/repositories/metrics-repository";
import { SOURCE_METRIC_DEFINITIONS, type MetricKey } from "@/domain/metrics";
import { getStockMetrics, StockMetricsRequestError } from "./stock-metrics-service";
import { retrieveSecurityMetrics } from "./security-metrics-service";
import { buildEtfMetricsOverview } from "./metrics-overview-model";
import { findEtfById, findSecuritiesByIds } from "@/db/repositories/catalog-repository";
import { GET } from "@/app/api/v1/metrics/stock/route";
import { loadUpcomingEarnings, saveUpcomingEarningsBatch } from "@/db/repositories/upcoming-earnings-repository";

test("stock requests share ETF observation caches and refresh only the selected company", async () => {
  const originalPath = process.env.DATABASE_PATH;
  const originalMode = process.env.SITE_ACCESS_MODE;
  const originalFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "stock-metrics-test-"));
  try {
    process.env.DATABASE_PATH = join(directory, "metrics.sqlite");
    process.env.SITE_ACCESS_MODE = "local";
    closeDatabase();
    ensureLocalDatabase();
    const skhy = findSecuritiesByIds(["US78392B2060"]).get("US78392B2060");
    assert.equal(skhy?.ticker, "SKHY");
    assert.equal(skhy?.exchange, "NASDAQ");
    assert.equal(skhy?.adrPremiumPairId, "sk-hynix");
    ensureMetricDefinitions();
    const securityId = "US55087P1049"; // Supported stock: LYFT.
    const capturedAt = new Date().toISOString();
    const values = Object.fromEntries(SOURCE_METRIC_DEFINITIONS.map(({ key }) => [key, key === "dividend_yield" ? 0 : 10])) as Partial<Record<MetricKey, number>>;
    saveProviderSymbolsBatch([{ securityId, providerSymbol: "NASDAQ:LYFT", status: "resolved", confidence: 1, verifiedAt: capturedAt }]);
    saveSecurityMetricsBatch([{ securityId, providerSymbol: "NASDAQ:LYFT", values }], capturedAt);
    const futureTimestamp = Math.floor((Date.now() + 7 * 86_400_000) / 1_000);
    const futureDate = new Date(futureTimestamp * 1_000).toISOString().slice(0, 10);
    saveUpcomingEarningsBatch([{ securityId, observation: {
      providerSymbol: "NASDAQ:LYFT", reportDate: futureDate, exchangeTimezone: "UTC",
    } }], capturedAt);
    saveEstimateSeriesBatch([{
      securityId,
      series: { providerSymbol: "NASDAQ:LYFT", currency: "USD", price: 100, points: Array.from({ length: 8 }, (_, index) => ({
        fiscalPeriod: `Q${index + 1}`, estimate: index < 4 ? 1 : 2, isHistorical: index < 4,
        analystCount: 10, estimateDate: null,
      })) },
    }], capturedAt);
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("Unexpected provider request"); };
    const stock = await getStockMetrics(securityId);
    assert.equal(calls, 0);
    assert.equal(stock.sourceStatus, "cached");
    assert.equal(stock.adrPremium, null);
    assert.equal(stock.upcomingEarnings.reportDate, futureDate);
    assert.equal(stock.upcomingEarnings.sourceStatus, "cached");
    assert.equal(stock.observations.values.pe_estimate_window_4, 12.5);
    assert.equal(stock.observations.values.eps_growth_estimate_forward_4q, 100);
    assert.equal(stock.observations.estimateSeries?.points.length, 8);

    const holding = { ...findSecuritiesByIds([securityId]).get(securityId)!, weight: 100 };
    const shared = await retrieveSecurityMetrics([holding]);
    const etf = buildEtfMetricsOverview({
      etf: findEtfById("ivv-us")!, holdings: [holding], asOf: capturedAt.slice(0, 10), fetchedAt: capturedAt,
      sourceStatus: "cached", sourceUrl: "https://example.test/holdings", cacheTtlHours: 24,
    }, shared.resolvedSecurityIds, shared.metricsBySecurity);
    assert.equal(etf.metrics.find((metric) => metric.key === "pe_estimate_window_4")?.value, stock.observations.values.pe_estimate_window_4);
    assert.equal(calls, 0);

    getSqlite().prepare("UPDATE metric_observations SET captured_at = '2000-01-01T00:00:00.000Z' WHERE entity_id = ? AND value_number IS NOT NULL").run(securityId);
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://scanner.tradingview.com/global/scan");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.symbols.tickers, ["NASDAQ:LYFT"]);
      assert.deepEqual(body.columns.slice(-2), ["earnings_release_next_date", "timezone"]);
      return Response.json({ data: [{ s: "NASDAQ:LYFT", d: ["LYFT", "LYFT INC CLASS A", "Industrials", ...SOURCE_METRIC_DEFINITIONS.map(({ key }) => key === "price_earnings_ttm" ? -12 : 10), futureTimestamp, "UTC"] }] });
    };
    const request = getStockMetrics(securityId);
    assert.equal(getStockMetrics(securityId), request);
    const refreshed = await request;
    assert.equal(calls, 1);
    assert.equal(refreshed.sourceStatus, "live");
    assert.equal(refreshed.observations.values.price_earnings_ttm, -12);
    assert.equal(refreshed.observations.estimateSeries?.price, 100);
    assert.equal(refreshed.upcomingEarnings.reportDate, futureDate);
    assert.equal(refreshed.upcomingEarnings.sourceStatus, "live");

    const response = await GET(new Request(`http://localhost/api/v1/metrics/stock?securityId=${securityId}`, { headers: { host: "localhost" } }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.security.securityId, securityId);
    assert.equal("metricsBySecurity" in payload.data, false);
    assert.equal(payload.data.consensusWindows["1q"].pePath.length, 8);
    assert.equal(payload.data.upcomingEarnings.reportDate, futureDate);
    assert.equal(calls, 1);
    // A stock previously analyzed only through an ETF has no earnings-calendar cache.
    getSqlite().prepare("DELETE FROM metric_observations WHERE metric_definition_id = 'security:upcoming_earnings:v1' AND entity_id = ?").run(securityId);
    const withCalendar = await getStockMetrics(securityId);
    assert.equal(calls, 2);
    assert.equal(withCalendar.upcomingEarnings.reportDate, futureDate);
    assert.equal(loadUpcomingEarnings([securityId]).get(securityId)?.reportDate, futureDate);

    // A failed calendar refresh retains the compatible future date, marked stale.
    getSqlite().prepare("UPDATE metric_observations SET captured_at = '2000-01-01T00:00:00.000Z' WHERE metric_definition_id = 'security:upcoming_earnings:v1' AND entity_id = ?").run(securityId);
    globalThis.fetch = async () => { throw new Error("Calendar transport unavailable"); };
    const fallback = await getStockMetrics(securityId);
    assert.equal(fallback.upcomingEarnings.reportDate, futureDate);
    assert.equal(fallback.upcomingEarnings.sourceStatus, "stale");

    // A successful null supersedes the old date and is cached without repeated requests.
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ data: [{ s: "NASDAQ:LYFT", d: ["LYFT", "LYFT INC CLASS A", "Industrials",
        ...SOURCE_METRIC_DEFINITIONS.map(() => 10), null, "UTC"] }] });
    };
    const withoutDate = await getStockMetrics(securityId);
    assert.equal(calls, 3);
    assert.equal(withoutDate.upcomingEarnings.reportDate, null);
    assert.equal(withoutDate.upcomingEarnings.sourceStatus, "live");
    assert.equal((await getStockMetrics(securityId)).upcomingEarnings.sourceStatus, "cached");
    assert.equal(calls, 3);
    await assert.rejects(getStockMetrics("unknown"), StockMetricsRequestError);
    assert.equal((await GET(new Request("http://localhost/api/v1/metrics/stock", { headers: { host: "localhost" } }))).status, 400);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    closeDatabase();
    if (originalPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalPath;
    if (originalMode === undefined) delete process.env.SITE_ACCESS_MODE;
    else process.env.SITE_ACCESS_MODE = originalMode;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
