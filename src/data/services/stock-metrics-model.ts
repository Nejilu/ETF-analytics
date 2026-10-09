import type { Holding } from "@/domain/etf";
import { METRIC_DEFINITIONS, type SecurityMetricValues } from "@/domain/metrics";
import type { StockMetricsMetadata, StockMetricsResult } from "@/domain/stock-metrics";
import { deriveConsensusWindow } from "@/domain/processors/derive-estimate-metrics";

/** Keep direct observations, including negative ratios, rather than ETF aggregation filters. */
export function buildStockMetricsResult(
  holding: Holding,
  observations: SecurityMetricValues | undefined,
  metadata: StockMetricsMetadata,
  providerSymbol = "",
): StockMetricsResult {
  const security = {
    securityId: holding.securityId,
    ticker: holding.ticker,
    name: holding.name,
    sector: holding.sector,
    country: holding.country,
    assetClass: holding.assetClass,
    isin: holding.isin,
    exchange: holding.exchange,
    currency: holding.currency,
  };
  const values = observations ?? { securityId: holding.securityId, providerSymbol, values: {} };
  const series = values.estimateSeries;
  return {
    ...metadata,
    definitions: [...METRIC_DEFINITIONS],
    security,
    observations: values,
    upcomingEarnings: { reportDate: null, exchangeTimezone: null, capturedAt: null, sourceStatus: "unavailable" },
    consensusWindows: {
      "4q": series ? deriveConsensusWindow(series, 4) : null,
      "2q": series ? deriveConsensusWindow(series, 2) : null,
      "1q": series ? deriveConsensusWindow(series, 1) : null,
    },
  };
}
