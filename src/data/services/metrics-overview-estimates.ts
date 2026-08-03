import type { Holding } from "@/domain/etf";
import type { MetricsOverviewWarning } from "@/domain/metrics";
import {
  estimateSeriesCacheKey,
  estimateSeriesMissingState,
  rememberAvailableEstimateSeries,
  rememberMissingEstimateSeries,
} from "@/domain/provider-negative-cache";
import {
  hasUnrefreshedCachedItems,
  needsEstimateSeriesRefresh,
  resolvedProviderSymbol,
} from "@/domain/metrics-cache";
import { databasePath } from "@/db/client";
import {
  deleteProviderNegativeCacheBatch,
  loadLatestEstimateSeries,
  saveProviderNegativeCacheBatch,
  saveEstimateSeriesBatch,
  type CachedEstimateSeries,
  type EstimateSeriesInput,
  type ProviderNegativeCacheEntry,
  type ProviderSymbolRecord,
} from "@/db/repositories/metrics-repository";
import { fetchTradingViewEstimateSeriesDetailed } from "@/data/providers/tradingview-estimates";

export interface RefreshEstimateSeriesInput {
  holdings: readonly Holding[];
  providerSymbols: ReadonlyMap<string, ProviderSymbolRecord>;
  securityIds: readonly string[];
  ttlSeconds: number;
  missingEstimateTtlMs: number;
}

export interface RefreshEstimateSeriesResult {
  cachedEstimateSeries: Map<string, CachedEstimateSeries>;
  estimateCoverageGaps: Set<string>;
  warnings: MetricsOverviewWarning[];
  hasLiveSource: boolean;
  hasPartialCoverage: boolean;
  hasStaleSource: boolean;
  seriesCount: number;
  failedSymbolCount: number;
  missingSymbolCount: number;
  requestedSymbolCount: number;
  batchCount: number;
  completedBatchCount: number;
  nonEmptyBatchCount: number;
  failedBatchCount: number;
}

export class EstimatesRefreshUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error
      ? `TradingView Estimates unavailable: ${cause.message}`
      : "TradingView Estimates unavailable.");
    this.name = "EstimatesRefreshUnavailableError";
  }
}

export function mergeEstimateSeriesCache(
  cachedEstimateSeries: Map<string, CachedEstimateSeries>,
  writes: readonly EstimateSeriesInput[],
  capturedAt: string,
): Map<string, CachedEstimateSeries> {
  if (writes.length === 0) return cachedEstimateSeries;
  const merged = new Map(cachedEstimateSeries);
  for (const write of writes) {
    merged.set(write.securityId, {
      series: write.series,
      capturedAt,
    });
  }
  return merged;
}

export async function refreshEstimateSeries(
  input: RefreshEstimateSeriesInput,
): Promise<RefreshEstimateSeriesResult> {
  let cachedEstimateSeries = loadLatestEstimateSeries([...input.securityIds]);
  // The database path is constant for this request; avoid resolving it once
  // per holding and per provider symbol while checking estimate absence.
  const metricsCachePath = databasePath();
  const estimateCoverageGaps = new Set<string>();
  const estimateSecurityIds = input.holdings
    .filter((holding) => {
      const cached = cachedEstimateSeries.get(holding.securityId);
      const providerSymbol = resolvedProviderSymbol(input.providerSymbols.get(holding.securityId));
      if (!providerSymbol) return false;
      const estimateCacheKey = estimateSeriesCacheKey(metricsCachePath, providerSymbol);
      const missingState = estimateSeriesMissingState(estimateCacheKey);
      if (missingState === "fresh") {
        estimateCoverageGaps.add(holding.securityId);
        return false;
      }
      if (missingState === "expired") return true;
      return needsEstimateSeriesRefresh(
        cached?.series.providerSymbol,
        providerSymbol,
        cached?.capturedAt,
        input.ttlSeconds,
      );
    })
    .map((holding) => holding.securityId);
  const estimateSymbols = [...new Set(estimateSecurityIds.flatMap((securityId) => {
    const symbol = resolvedProviderSymbol(input.providerSymbols.get(securityId));
    return symbol ? [symbol] : [];
  }))];
  const warnings = new Set<MetricsOverviewWarning>();
  let hasLiveSource = false;
  let hasPartialCoverage = false;
  let hasStaleSource = false;
  let seriesCount = 0;
  let failedSymbolCount = 0;
  let missingSymbolCount = 0;
  const requestedSymbolCount = estimateSymbols.length;
  let batchCount = 0;
  let completedBatchCount = 0;
  let nonEmptyBatchCount = 0;
  let failedBatchCount = 0;

  if (estimateSymbols.length > 0) {
    try {
      const cachedEstimateIdsBeforeRefresh = new Set(cachedEstimateSeries.keys());
      const estimateResult = await fetchTradingViewEstimateSeriesDetailed(estimateSymbols);
      batchCount = estimateResult.batchCount;
      completedBatchCount = estimateResult.completedBatchCount;
      nonEmptyBatchCount = estimateResult.nonEmptyBatchCount;
      failedBatchCount = estimateResult.failedBatchCount;
      const seriesBySymbol = new Map(
        estimateResult.series.map((series) => [series.providerSymbol, series]),
      );
      const failedEstimateSymbols = new Set(estimateResult.failedSymbols);
      const missingSymbols = new Set(estimateResult.missingSymbols);
      const missingEstimateSeries = estimateSecurityIds.some((securityId) => {
        const symbol = resolvedProviderSymbol(input.providerSymbols.get(securityId));
        return Boolean(symbol && missingSymbols.has(symbol));
      });
      seriesCount = estimateResult.series.length;
      failedSymbolCount = failedEstimateSymbols.size;
      missingSymbolCount = missingSymbols.size;
      estimateSymbols.forEach((symbol) => {
        const key = estimateSeriesCacheKey(metricsCachePath, symbol);
        if (missingSymbols.has(symbol) && !failedEstimateSymbols.has(symbol)) {
          rememberMissingEstimateSeries(key, input.missingEstimateTtlMs);
        } else if (seriesBySymbol.has(symbol)) {
          rememberAvailableEstimateSeries(key);
        }
      });
      if (missingSymbols.size > 0) {
        estimateSecurityIds.filter((securityId) => {
          const symbol = resolvedProviderSymbol(input.providerSymbols.get(securityId));
          return Boolean(symbol && missingSymbols.has(symbol));
        }).forEach((securityId) => estimateCoverageGaps.add(securityId));
      }
      const capturedAt = new Date().toISOString();
      const capturedAtMs = Date.parse(capturedAt);
      const negativeCacheWrites: ProviderNegativeCacheEntry[] = [];
      const negativeCacheDeletes: ProviderNegativeCacheEntry[] = [];
      for (const symbol of estimateSymbols) {
        if (missingSymbols.has(symbol) && !failedEstimateSymbols.has(symbol)) {
          negativeCacheWrites.push({
            provider: "tradingview",
            cacheKind: "estimate_series",
            providerSymbol: symbol,
            metricKey: "",
            expiresAt: capturedAtMs + input.missingEstimateTtlMs,
          });
        } else if (seriesBySymbol.has(symbol)) {
          negativeCacheDeletes.push({
            provider: "tradingview",
            cacheKind: "estimate_series",
            providerSymbol: symbol,
            metricKey: "",
            expiresAt: 0,
          });
        }
      }
      const estimateWrites: EstimateSeriesInput[] = [];
      for (const securityId of estimateSecurityIds) {
        const symbol = resolvedProviderSymbol(input.providerSymbols.get(securityId));
        const series = symbol ? seriesBySymbol.get(symbol) : undefined;
        if (series) estimateWrites.push({ securityId, series });
      }
      saveEstimateSeriesBatch(estimateWrites, capturedAt);
      saveProviderNegativeCacheBatch(negativeCacheWrites);
      deleteProviderNegativeCacheBatch(negativeCacheDeletes);
      // The initial cache is complete for existing series. Merge successful
      // writes locally instead of rereading every security from SQLite; the
      // negative cache below masks explicitly unavailable series.
      cachedEstimateSeries = mergeEstimateSeriesCache(
        cachedEstimateSeries,
        estimateWrites,
        capturedAt,
      );
      hasLiveSource = seriesBySymbol.size > 0;
      const failedEstimateSecurityIds = estimateSecurityIds.filter((securityId) => {
        const symbol = resolvedProviderSymbol(input.providerSymbols.get(securityId));
        return Boolean(symbol && failedEstimateSymbols.has(symbol));
      });
      const hasUnrefreshedEstimates = hasUnrefreshedCachedItems(
        failedEstimateSecurityIds,
        new Set(estimateWrites.map((estimate) => estimate.securityId)),
        cachedEstimateIdsBeforeRefresh,
      );
      hasPartialCoverage = missingEstimateSeries;
      // A failed WebSocket batch is a transport failure, not a confirmed
      // absence. Keep the result stale even when no older series exists for
      // one of the failed securities; confirmed empty responses remain only
      // partial through missingEstimateSeries.
      hasStaleSource = hasUnrefreshedEstimates || failedEstimateSecurityIds.length > 0;
      if (missingEstimateSeries) warnings.add("estimates-partial");
      if (hasStaleSource) warnings.add("estimates-unavailable");
    } catch (error) {
      if (cachedEstimateSeries.size === 0) {
        throw new EstimatesRefreshUnavailableError(error);
      }
      warnings.add("estimates-unavailable");
      hasStaleSource = true;
    }
  }

  if (estimateCoverageGaps.size > 0) {
    hasPartialCoverage = true;
    warnings.add("estimates-partial");
  }

  return {
    cachedEstimateSeries,
    estimateCoverageGaps,
    warnings: [...warnings],
    hasLiveSource,
    hasPartialCoverage,
    hasStaleSource,
    seriesCount,
    failedSymbolCount,
    missingSymbolCount,
    requestedSymbolCount,
    batchCount,
    completedBatchCount,
    nonEmptyBatchCount,
    failedBatchCount,
  };
}
