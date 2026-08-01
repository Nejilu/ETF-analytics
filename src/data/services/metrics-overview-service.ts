import "server-only";

import { aggregateEtfMetrics } from "@/domain/processors/aggregate-etf-metrics";
import {
  DERIVED_METRIC_KEYS,
  METRIC_DEFINITIONS,
  OVERVIEW_METRIC_DEFINITIONS,
  type ComponentValuationView,
  type MetricsOverviewResult,
  type SecurityMetricValues,
} from "@/domain/metrics";
import type { Holding } from "@/domain/etf";
import { ensureLocalDatabase } from "@/db/bootstrap";
import {
  ensureMetricDefinitions,
  loadLatestEstimateSeries,
  loadLatestSecurityMetrics,
  loadProviderSymbols,
  saveEstimateSeries,
  saveProviderSymbol,
  saveDerivedSecurityMetrics,
  saveSecurityMetrics,
} from "@/db/repositories/metrics-repository";
import { findEtfByReference } from "@/db/repositories/catalog-repository";
import { fetchTradingViewMetrics } from "@/data/providers/tradingview-screener";
import { fetchTradingViewEstimateSeries } from "@/data/providers/tradingview-estimates";
import { tradingViewSymbolCandidates } from "@/data/providers/tradingview-symbols";
import { deriveEstimateSeriesMetrics } from "@/domain/processors/derive-estimate-metrics";
import { getHoldingsSnapshot } from "./holdings-service";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const COMPONENT_POINT_LIMIT = 500;
const inFlightRequests = new Map<string, Promise<MetricsOverviewResult>>();

function cacheTtlSeconds(): number {
  const configured = Number(process.env.TRADINGVIEW_METRICS_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_SECONDS;
}

function isFresh(capturedAt: string, ttlSeconds: number): boolean {
  const timestamp = Date.parse(capturedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlSeconds * 1_000;
}

function equityHoldings(holdings: Holding[]): Holding[] {
  return holdings.filter((holding) =>
    holding.weight > 0 && holding.assetClass.toLocaleLowerCase("en-US").includes("equity"));
}

function uniqueHoldings(snapshots: Awaited<ReturnType<typeof getHoldingsSnapshot>>[]): Holding[] {
  const result = new Map<string, Holding>();
  for (const snapshot of snapshots) {
    for (const holding of equityHoldings(snapshot.holdings)) {
      const current = result.get(holding.securityId);
      if (!current || (!current.exchange && holding.exchange)) {
        result.set(holding.securityId, holding);
      }
    }
  }
  return [...result.values()];
}

function normalizedWords(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2 && !["inc", "ltd", "plc", "corp", "sa", "nv"].includes(word)));
}

function nameScore(expected: string, actual: string | null): number {
  if (!actual) return 0;
  const expectedWords = normalizedWords(expected);
  const actualWords = normalizedWords(actual);
  if (expectedWords.size === 0) return 0;
  let common = 0;
  for (const word of expectedWords) if (actualWords.has(word)) common += 1;
  return common / expectedWords.size;
}

function materiallyDifferent(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left !== right;
  return Math.abs(left - right) > Math.max(1e-9, Math.abs(right) * 1e-9);
}

function buildComponentValuation(
  holdings: Holding[],
  metricsBySecurity: ReadonlyMap<string, SecurityMetricValues>,
): ComponentValuationView {
  const eligibleHoldings = equityHoldings(holdings);
  const totalWeight = eligibleHoldings.reduce((sum, holding) => sum + holding.weight, 0);
  const eligiblePoints = eligibleHoldings.flatMap((holding) => {
    const securityMetrics = metricsBySecurity.get(holding.securityId);
    const peHistoricalEstimate4q = securityMetrics?.values.pe_estimate_window_0;
    const peForwardEstimate4q = securityMetrics?.values.pe_estimate_window_4;
    const epsGrowthEstimate4q = securityMetrics?.values.eps_growth_estimate_forward_4q;
    const series = securityMetrics?.estimateSeries;
    if (
      !securityMetrics || !series ||
      !Number.isFinite(peHistoricalEstimate4q) ||
      !Number.isFinite(peForwardEstimate4q) ||
      !Number.isFinite(epsGrowthEstimate4q)
    ) {
      return [];
    }
    const historicalEstimateSum = series.points.slice(0, 4)
      .reduce((sum, point) => sum + point.estimate, 0);
    const forwardEstimateSum = series.points.slice(4, 8)
      .reduce((sum, point) => sum + point.estimate, 0);
    return [{
      securityId: holding.securityId,
      ticker: holding.ticker,
      name: holding.name,
      sector: holding.sector,
      country: holding.country,
      providerSymbol: securityMetrics.providerSymbol,
      weight: holding.weight,
      peHistoricalEstimate4q: peHistoricalEstimate4q as number,
      peForwardEstimate4q: peForwardEstimate4q as number,
      epsGrowthEstimate4q: epsGrowthEstimate4q as number,
      historicalEstimateSum,
      forwardEstimateSum,
      price: series.price,
      currency: series.currency,
      estimatePoints: series.points,
    }];
  });
  const validPoints = eligiblePoints.filter((point) => point.peForwardEstimate4q > 0);
  const points = validPoints
    .sort((left, right) => right.weight - left.weight)
    .slice(0, COMPONENT_POINT_LIMIT);
  const representedWeight = points.reduce((sum, point) => sum + point.weight, 0);
  const minGrowth = points.length
    ? Math.min(-10, Math.floor(Math.min(...points.map((point) => point.epsGrowthEstimate4q)) / 10) * 10)
    : -10;
  const maxGrowth = points.length
    ? Math.max(30, Math.ceil(Math.max(...points.map((point) => point.epsGrowthEstimate4q)) / 10) * 10)
    : 30;
  const maxPe = points.length
    ? Math.max(30, Math.ceil(Math.max(...points.map((point) => point.peForwardEstimate4q)) / 10) * 10)
    : 30;
  return {
    points,
    eligibleCount: eligiblePoints.length,
    displayedCount: points.length,
    excludedOutlierCount: 0,
    representedWeight: totalWeight > 0 ? (representedWeight / totalWeight) * 100 : 0,
    axisLimits: { minGrowth, maxGrowth, maxPe },
  };
}

async function buildOverview(references: string[]): Promise<MetricsOverviewResult> {
  ensureLocalDatabase();
  ensureMetricDefinitions();
  const etfs = references.map((reference) => findEtfByReference(reference));
  if (etfs.some((etf) => !etf)) {
    throw new Error("Invalid ETF selection. Use funds available in the catalog.");
  }
  const snapshots = await Promise.all(references.map(getHoldingsSnapshot));
  const holdings = uniqueHoldings(snapshots);
  const securityIds = holdings.map((holding) => holding.securityId);
  const ttlSeconds = cacheTtlSeconds();
  const providerSymbols = loadProviderSymbols(securityIds);
  let cachedMetrics = loadLatestSecurityMetrics(securityIds);
  const needsRefresh = new Set(holdings.flatMap((holding) => {
    const cached = cachedMetrics.get(holding.securityId);
    return !cached ||
      cached.observedKeys.size < METRIC_DEFINITIONS.length ||
      !isFresh(cached.capturedAt, ttlSeconds)
      ? [holding.securityId]
      : [];
  }));
  for (const holding of holdings) {
    const persisted = providerSymbols.get(holding.securityId)?.providerSymbol;
    if (
      persisted &&
      /\badr\b|depositary/i.test(holding.name) &&
      !tradingViewSymbolCandidates(holding).includes(persisted)
    ) {
      needsRefresh.add(holding.securityId);
    }
  }

  const candidatesBySecurity = new Map<string, string[]>();
  for (const holding of holdings) {
    if (!needsRefresh.has(holding.securityId)) continue;
    const providerRecord = providerSymbols.get(holding.securityId);
    const persisted = providerRecord?.providerSymbol;
    const generatedCandidates = tradingViewSymbolCandidates(holding);
    const depositaryListingConflict = Boolean(
      persisted &&
      !generatedCandidates.includes(persisted) &&
      /\badr\b|depositary/i.test(holding.name),
    );
    const recentlyUnresolved = providerRecord?.status === "unresolved" &&
      isFresh(providerRecord.lastVerifiedAt, ttlSeconds);
    const candidates = persisted && !depositaryListingConflict
      ? [persisted]
      : recentlyUnresolved
        ? []
        : generatedCandidates;
    candidatesBySecurity.set(holding.securityId, candidates);
  }

  const requestedSymbols = [...new Set([...candidatesBySecurity.values()].flat())];
  let sourceStatus: MetricsOverviewResult["sourceStatus"] = "cached";
  if (requestedSymbols.length > 0) {
    try {
      const observations = await fetchTradingViewMetrics(requestedSymbols);
      const bySymbol = new Map(observations.map((observation) => [observation.symbol, observation]));
      const capturedAt = new Date().toISOString();
      for (const holding of holdings) {
        if (!needsRefresh.has(holding.securityId)) continue;
        const candidates = candidatesBySecurity.get(holding.securityId) ?? [];
        const matches = candidates
          .flatMap((symbol, position) => {
            const observation = bySymbol.get(symbol);
            return observation
              ? [{ observation, position, score: nameScore(holding.name, observation.description) }]
              : [];
          })
          .sort((left, right) => right.score - left.score || left.position - right.position);
        const match = matches[0];
        if (!match) {
          if (!providerSymbols.get(holding.securityId)?.providerSymbol) {
            saveProviderSymbol({
              securityId: holding.securityId,
              providerSymbol: null,
              status: "unresolved",
              confidence: null,
              metadata: { candidates, ticker: holding.ticker, exchange: holding.exchange ?? null },
              verifiedAt: capturedAt,
            });
          }
          continue;
        }
        const confidence = holding.exchange ? Math.max(0.9, match.score) : Math.max(0.65, match.score);
        saveProviderSymbol({
          securityId: holding.securityId,
          providerSymbol: match.observation.symbol,
          status: "resolved",
          confidence,
          metadata: {
            ticker: holding.ticker,
            exchange: holding.exchange ?? null,
            description: match.observation.description,
            sector: match.observation.sector,
            alternativesTested: candidates.length,
          },
          verifiedAt: capturedAt,
        });
        saveSecurityMetrics(
          holding.securityId,
          match.observation.symbol,
          match.observation.values,
          capturedAt,
        );
        providerSymbols.set(holding.securityId, {
          securityId: holding.securityId,
          providerSymbol: match.observation.symbol,
          status: "resolved",
          lastVerifiedAt: capturedAt,
        });
      }
      cachedMetrics = loadLatestSecurityMetrics(securityIds);
      sourceStatus = "live";
    } catch (error) {
      if (cachedMetrics.size === 0) throw error;
      sourceStatus = "stale";
    }
  }

  let cachedEstimateSeries = loadLatestEstimateSeries(securityIds);
  const estimateSecurityIds = holdings
    .filter((holding) => {
      const cached = cachedEstimateSeries.get(holding.securityId);
      return Boolean(providerSymbols.get(holding.securityId)?.providerSymbol) &&
        (!cached || !isFresh(cached.capturedAt, ttlSeconds));
    })
    .map((holding) => holding.securityId);
  const estimateSymbols = [...new Set(estimateSecurityIds.flatMap((securityId) => {
    const symbol = providerSymbols.get(securityId)?.providerSymbol;
    return symbol ? [symbol] : [];
  }))];
  if (estimateSymbols.length > 0) {
    try {
      const seriesBySymbol = new Map(
        (await fetchTradingViewEstimateSeries(estimateSymbols))
          .map((series) => [series.providerSymbol, series]),
      );
      const capturedAt = new Date().toISOString();
      for (const securityId of estimateSecurityIds) {
        const symbol = providerSymbols.get(securityId)?.providerSymbol;
        const series = symbol ? seriesBySymbol.get(symbol) : undefined;
        if (series) saveEstimateSeries(securityId, series, capturedAt);
      }
      cachedEstimateSeries = loadLatestEstimateSeries(securityIds);
      if (seriesBySymbol.size > 0) sourceStatus = "live";
    } catch (error) {
      if (cachedEstimateSeries.size === 0) throw error;
      sourceStatus = "stale";
    }
  }

  const metricsBySecurity = new Map<string, SecurityMetricValues>();
  for (const holding of holdings) {
    const securityId = holding.securityId;
    const cached = cachedMetrics.get(securityId);
    const estimateCache = cachedEstimateSeries.get(securityId);
    const correctedValues = {
      ...(cached?.values ?? {}),
      ...(estimateCache ? deriveEstimateSeriesMetrics(estimateCache.series) : {}),
    };
    const derivedChanged = DERIVED_METRIC_KEYS.some((key) =>
      materiallyDifferent(cached?.values[key], correctedValues[key]));
    const providerSymbol = estimateCache?.series.providerSymbol ?? cached?.providerSymbol ?? "";
    if (derivedChanged && providerSymbol) {
      saveDerivedSecurityMetrics(
        securityId,
        providerSymbol,
        correctedValues,
        estimateCache?.capturedAt ?? cached?.capturedAt ?? new Date().toISOString(),
      );
    }
    if (!cached && !estimateCache) continue;
    metricsBySecurity.set(securityId, {
      securityId,
      providerSymbol,
      values: correctedValues,
      estimateSeries: estimateCache?.series,
    });
  }

  return {
    calculatedAt: new Date().toISOString(),
    source: "TradingView Screener + Estimates",
    sourceStatus,
    cacheTtlHours: ttlSeconds / 3_600,
    definitions: [...OVERVIEW_METRIC_DEFINITIONS],
    etfs: snapshots.map((snapshot) => {
      const eligible = equityHoldings(snapshot.holdings);
      const totalWeight = eligible.reduce((sum, holding) => sum + holding.weight, 0);
      const mapped = eligible.filter((holding) =>
        Boolean(providerSymbols.get(holding.securityId)?.providerSymbol));
      const mappedWeight = mapped.reduce((sum, holding) => sum + holding.weight, 0);
      return {
        etfId: snapshot.etf.id,
        ticker: snapshot.etf.ticker,
        name: snapshot.etf.name,
        asOf: snapshot.asOf,
        holdingsCount: eligible.length,
        mappedHoldings: mapped.length,
        mappingCoverageWeight: totalWeight > 0 ? (mappedWeight / totalWeight) * 100 : 0,
        metrics: aggregateEtfMetrics(snapshot.holdings, metricsBySecurity),
        componentValuation: buildComponentValuation(snapshot.holdings, metricsBySecurity),
      };
    }),
  };
}

export class MetricsOverviewUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error
      ? `TradingView metrics are unavailable: ${cause.message}`
      : "TradingView metrics are unavailable.");
    this.name = "MetricsOverviewUnavailableError";
  }
}

export function getMetricsOverview(references: string[]): Promise<MetricsOverviewResult> {
  const normalized = [...new Set(references.map((reference) => reference.trim()).filter(Boolean))];
  if (normalized.length < 1 || normalized.length > 4) {
    return Promise.reject(new Error("Select between one and four ETFs."));
  }
  const key = normalized.slice().sort().join("|");
  const existing = inFlightRequests.get(key);
  if (existing) return existing;
  const request = buildOverview(normalized)
    .catch((error) => {
      throw error instanceof MetricsOverviewUnavailableError
        ? error
        : new MetricsOverviewUnavailableError(error);
    })
    .finally(() => inFlightRequests.delete(key));
  inFlightRequests.set(key, request);
  return request;
}
