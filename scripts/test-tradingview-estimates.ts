import assert from "node:assert/strict";

import { fetchTradingViewEstimateSeries } from "../src/data/providers/tradingview-estimates";
import { deriveEstimateSeriesMetrics } from "../src/domain/processors/derive-estimate-metrics";

const requested = ["NASDAQ:MSFT", "NASDAQ:GOOGL", "TWSE:2330"];
const series = await fetchTradingViewEstimateSeries(requested);
assert.equal(series.length, requested.length);

for (const security of series) {
  assert.equal(security.points.length, 8);
  assert.equal(security.points.filter((point) => point.isHistorical).length, 4);
  assert.equal(security.points.filter((point) => !point.isHistorical).length, 4);
  const metrics = deriveEstimateSeriesMetrics(security);
  assert.ok((metrics.pe_estimate_window_0 ?? 0) > 0);
  assert.ok((metrics.pe_estimate_window_4 ?? 0) > 0);
  console.log(JSON.stringify({
    symbol: security.providerSymbol,
    currency: security.currency,
    price: security.price,
    historical: security.points.slice(0, 4).map((point) => [point.fiscalPeriod, point.estimate]),
    forward: security.points.slice(4).map((point) => [point.fiscalPeriod, point.estimate]),
    peHistoricalEstimate4q: metrics.pe_estimate_window_0,
    peForwardEstimate4q: metrics.pe_estimate_window_4,
    epsGrowthEstimate4q: metrics.eps_growth_estimate_forward_4q,
  }));
}
