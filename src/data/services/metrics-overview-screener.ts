import type { Holding } from "@/domain/etf";
import {
  SOURCE_METRIC_DEFINITIONS,
  type MetricKey,
  type MetricsOverviewWarning,
} from "@/domain/metrics";
import {
  tradingViewSymbolCandidateDetails,
  type TradingViewSymbolCandidate,
  type TradingViewMappingProvenance,
} from "@/data/providers/tradingview-symbols";
import {
  hasUnrefreshedCachedItems,
  hasUnresolvedRefreshCandidates,
  isSourceMetricsCompatible,
  providerCandidatesMatch,
  resolvedProviderSymbol,
  shouldInvalidateProviderMapping,
  shouldPreserveUnresolvedMapping,
  shouldRetryUnresolvedMapping,
  shouldUseCachedSourceMetric,
} from "@/domain/metrics-cache";
import {
  rememberAvailableSourceMetric,
  rememberMissingSourceMetric,
  sourceMetricCacheKey,
  sourceMetricMissingState,
} from "@/domain/provider-negative-cache";
import {
  fetchTradingViewMetrics,
  type TradingViewSecurityMetrics,
} from "@/data/providers/tradingview-screener";
import {
  deleteProviderNegativeCacheBatch,
  saveProviderNegativeCacheBatch,
  saveProviderSymbolsBatch,
  saveSecurityMetricsBatch,
  type CachedSecurityMetrics,
  type ProviderNegativeCacheEntry,
  type ProviderSymbolInput,
  type ProviderSymbolRecord,
  type SecurityMetricsInput,
} from "@/db/repositories/metrics-repository";
import { databasePath } from "@/db/client";

export interface PrepareScreenerRefreshInput {
  holdings: readonly Holding[];
  providerSymbols: ReadonlyMap<string, ProviderSymbolRecord>;
  cachedMetrics: ReadonlyMap<string, CachedSecurityMetrics>;
  ttlSeconds: number;
}

/**
 * Keep source-cache compatibility beside the Screener refresh code. The
 * orchestrator only needs the resulting values and no longer knows how a
 * missing source field is represented in the negative cache.
 */
export function compatibleCachedSourceValues(
  cached: CachedSecurityMetrics | undefined,
  currentProviderSymbol: string | undefined,
  cachePath: string,
): Partial<Record<MetricKey, number>> {
  if (!cached || !currentProviderSymbol) return {};
  const values = { ...cached.values };
  for (const definition of SOURCE_METRIC_DEFINITIONS) {
    const missingNow = sourceMetricMissingState(
      sourceMetricCacheKey(cachePath, currentProviderSymbol, definition.key),
    ) === "fresh";
    if (!shouldUseCachedSourceMetric(
      cached.sourceProviderSymbolByKey.get(definition.key),
      currentProviderSymbol,
      missingNow,
    )) {
      delete values[definition.key];
    }
  }
  return values;
}

export interface ScreenerRefreshPlan {
  needsRefresh: Set<string>;
  candidatesBySecurity: Map<string, string[]>;
  candidateDetailsBySecurity: Map<string, TradingViewSymbolCandidate[]>;
  requestedSymbols: string[];
  hasUnresolvedCandidates: boolean;
  sourceMetricCoverageGaps: Set<string>;
}

export function prepareScreenerRefresh(
  input: PrepareScreenerRefreshInput,
): ScreenerRefreshPlan {
  const sourceMetricCoverageGaps = new Set<string>();
  // The database path is constant for this request; avoid resolving it for
  // every source metric while checking the refresh plan.
  const metricsCachePath = databasePath();
  // Candidate generation normalizes exchange, ticker and aliases. It is pure
  // for a holding, so keep the result for this plan instead of rebuilding the
  // same arrays and details in each pass below. The map is request-local:
  // mappings still get regenerated on the next request and no stale provider
  // state is kept.
  const generatedCandidateDetailsBySecurity = new Map<string, TradingViewSymbolCandidate[]>();
  const generatedCandidatesBySecurity = new Map<string, string[]>();
  const generatedCandidateDetailsFor = (holding: Holding): TradingViewSymbolCandidate[] => {
    const cached = generatedCandidateDetailsBySecurity.get(holding.securityId);
    if (cached) return cached;
    const generated = tradingViewSymbolCandidateDetails(holding);
    generatedCandidateDetailsBySecurity.set(holding.securityId, generated);
    return generated;
  };
  const generatedCandidatesFor = (holding: Holding): string[] => {
    const cached = generatedCandidatesBySecurity.get(holding.securityId);
    if (cached) return cached;
    const generated = generatedCandidateDetailsFor(holding).map((candidate) => candidate.symbol);
    generatedCandidatesBySecurity.set(holding.securityId, generated);
    return generated;
  };
  const needsRefresh = new Set(input.holdings.flatMap((holding) => {
    const cached = input.cachedMetrics.get(holding.securityId);
    const providerSymbol = resolvedProviderSymbol(input.providerSymbols.get(holding.securityId));
    const sourceMetricsAreFresh = Boolean(providerSymbol) && SOURCE_METRIC_DEFINITIONS.every(({ key }) => {
      const cacheKey = providerSymbol
        ? sourceMetricCacheKey(metricsCachePath, providerSymbol, key)
        : "";
      const missingState = providerSymbol ? sourceMetricMissingState(cacheKey) : "absent";
      if (missingState === "fresh") {
        sourceMetricCoverageGaps.add(holding.securityId);
        return true;
      }
      if (missingState === "expired") return false;
      if (!isSourceMetricsCompatible(
        cached?.sourceProviderSymbolByKey.get(key),
        providerSymbol,
      )) return false;
      return isFreshTimestamp(cached?.sourceCapturedAtByKey.get(key), input.ttlSeconds);
    });
    return sourceMetricsAreFresh ? [] : [holding.securityId];
  }));
  for (const holding of input.holdings) {
    const providerRecord = input.providerSymbols.get(holding.securityId);
    const persisted = resolvedProviderSymbol(providerRecord);
    const generatedCandidates = generatedCandidatesFor(holding);
    if (shouldRetryUnresolvedMapping(
      providerRecord?.status,
      providerRecord?.lastVerifiedAt,
      providerRecord?.metadata,
      generatedCandidates,
      input.ttlSeconds,
    )) {
      needsRefresh.add(holding.securityId);
    }
    if (persisted && !generatedCandidates.includes(persisted)) {
      needsRefresh.add(holding.securityId);
    }
  }

  const candidatesBySecurity = new Map<string, string[]>();
  for (const holding of input.holdings) {
    if (!needsRefresh.has(holding.securityId)) continue;
    const providerRecord = input.providerSymbols.get(holding.securityId);
    const persisted = resolvedProviderSymbol(providerRecord);
    const generatedCandidates = generatedCandidatesFor(holding);
    const persistedListingConflict = Boolean(
      persisted &&
      !generatedCandidates.includes(persisted),
    );
    const recentlyUnresolved = providerRecord?.status === "unresolved" &&
      isFreshTimestamp(providerRecord.lastVerifiedAt, input.ttlSeconds) &&
      providerCandidatesMatch(providerRecord.metadata, generatedCandidates);
    const candidates = persisted && !persistedListingConflict
      ? [persisted]
      : recentlyUnresolved
        ? []
        : generatedCandidates;
    candidatesBySecurity.set(holding.securityId, candidates);
  }
  const requestedSymbols = [...new Set([...candidatesBySecurity.values()].flat())];
  const candidateDetailsBySecurity = new Map<string, TradingViewSymbolCandidate[]>();
  for (const securityId of needsRefresh) {
    const details = generatedCandidateDetailsBySecurity.get(securityId);
    if (details) candidateDetailsBySecurity.set(securityId, details);
  }
  return {
    needsRefresh,
    candidatesBySecurity,
    candidateDetailsBySecurity,
    requestedSymbols,
    hasUnresolvedCandidates: hasUnresolvedRefreshCandidates(
      [...needsRefresh],
      candidatesBySecurity,
    ),
    sourceMetricCoverageGaps,
  };
}

function isFreshTimestamp(capturedAt: string | undefined, ttlSeconds: number): boolean {
  const timestamp = Date.parse(capturedAt ?? "");
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlSeconds * 1_000;
}

function normalizedTicker(value: string): string {
  return value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]+/g, "");
}

export function hasSufficientMappingEvidence(
  holding: Holding,
  observation: TradingViewSecurityMetrics,
  provenance: TradingViewMappingProvenance,
  score: number,
): boolean {
  // Explicitly probed aliases are trusted even when the provider uses a
  // different ticker spelling or a different listing exchange. Exact and
  // country-derived candidates still need one piece of issuer evidence when
  // the provider ticker does not match: otherwise a same-exchange collision
  // could silently attach the metrics of another security.
  if (provenance === "confirmed_alias" || provenance === "cross_exchange") return true;
  return score >= 0.25 || (
    typeof observation.ticker === "string" &&
    normalizedTicker(observation.ticker) === normalizedTicker(holding.ticker)
  );
}

export function mappingConfidence(
  provenance: TradingViewMappingProvenance,
  score: number,
): number {
  const floorByProvenance: Record<TradingViewMappingProvenance, number> = {
    exact_exchange: 0.75,
    confirmed_alias: 0.8,
    country_fallback: 0.5,
    cross_exchange: 0.6,
  };
  const floor = floorByProvenance[provenance];
  return Math.round(Math.min(1, floor + (1 - floor) * score) * 1_000) / 1_000;
}

function normalizedWords(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2 && !["inc", "ltd", "plc", "corp", "sa", "nv"].includes(word)));
}

export function nameScore(expected: string, actual: string | null): number {
  if (!actual) return 0;
  const expectedWords = normalizedWords(expected);
  const actualWords = normalizedWords(actual);
  if (expectedWords.size === 0) return 0;
  let common = 0;
  for (const word of expectedWords) if (actualWords.has(word)) common += 1;
  return common / expectedWords.size;
}

export function candidatesConfirmedMissing(
  candidates: readonly string[],
  missingSymbols: ReadonlySet<string>,
  failedSymbols: ReadonlySet<string>,
): boolean {
  // No generated candidate is a deterministic unresolved mapping; with
  // candidates present, every symbol must be explicitly missing and none may
  // have failed at transport level.
  return candidates.length === 0 || candidates.every((symbol) =>
    missingSymbols.has(symbol) && !failedSymbols.has(symbol));
}

/**
 * Return securities for which a failed provider symbol is still unresolved.
 * A failed alias is harmless when another candidate produced a mapping in the
 * same response; only the unresolved cases should make the result stale.
 */
export function transportFailedSecurityIds(
  holdings: readonly Holding[],
  needsRefresh: ReadonlySet<string>,
  candidatesBySecurity: ReadonlyMap<string, readonly string[]>,
  failedSymbols: ReadonlySet<string>,
  writtenSecurityIds: ReadonlySet<string>,
): string[] {
  return holdings.flatMap((holding) => {
    if (!needsRefresh.has(holding.securityId)) return [];
    const candidates = candidatesBySecurity.get(holding.securityId) ?? [];
    return candidates.some((symbol) => failedSymbols.has(symbol)) &&
      !writtenSecurityIds.has(holding.securityId)
      ? [holding.securityId]
      : [];
  });
}

/**
 * Reconcile a request-local coverage gap with the fields returned by the
 * current Screener observation. A negative-cache gap is only a statement
 * about the last response; a complete later response must be allowed to clear
 * it before the service computes its final source status.
 */
export function reconcileSourceMetricCoverageGap(
  coverageGaps: Set<string>,
  securityId: string,
  observedMetricCount: number,
): void {
  if (observedMetricCount < SOURCE_METRIC_DEFINITIONS.length) {
    coverageGaps.add(securityId);
  } else {
    coverageGaps.delete(securityId);
  }
}

export interface ScreenerMatch {
  observation: TradingViewSecurityMetrics;
  position: number;
  score: number;
}

export function selectBestScreenerMatch(
  holdingName: string,
  candidates: readonly string[],
  observationsBySymbol: ReadonlyMap<string, TradingViewSecurityMetrics>,
): ScreenerMatch | undefined {
  return candidates
    .flatMap((symbol, position) => {
      const observation = observationsBySymbol.get(symbol);
      return observation
        ? [{ observation, position, score: nameScore(holdingName, observation.description) }]
        : [];
    })
    .sort((left, right) => right.score - left.score || left.position - right.position)[0];
}

export interface RefreshScreenerMetricsInput {
  holdings: readonly Holding[];
  needsRefresh: ReadonlySet<string>;
  candidatesBySecurity: ReadonlyMap<string, readonly string[]>;
  candidateDetailsBySecurity?: ReadonlyMap<string, readonly TradingViewSymbolCandidate[]>;
  requestedSymbols: readonly string[];
  providerSymbols: ReadonlyMap<string, ProviderSymbolRecord>;
  cachedMetrics: Map<string, CachedSecurityMetrics>;
  securityIds: readonly string[];
  missingSourceMetricTtlMs: number;
  sourceMetricCoverageGaps?: ReadonlySet<string>;
}

export interface RefreshScreenerMetricsResult {
  providerSymbols: Map<string, ProviderSymbolRecord>;
  cachedMetrics: Map<string, CachedSecurityMetrics>;
  sourceMetricCoverageGaps: Set<string>;
  warnings: MetricsOverviewWarning[];
  hasLiveSource: boolean;
  hasPartialCoverage: boolean;
  hasStaleSource: boolean;
  observationCount: number;
  failedSymbolCount: number;
  missingSymbolCount: number;
}

export class ScreenerRefreshUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error
      ? `TradingView Screener unavailable: ${cause.message}`
      : "TradingView Screener unavailable.");
    this.name = "ScreenerRefreshUnavailableError";
  }
}

function emptyResult(
  input: RefreshScreenerMetricsInput,
  providerSymbols: Map<string, ProviderSymbolRecord>,
  sourceMetricCoverageGaps: Set<string>,
): RefreshScreenerMetricsResult {
  const hasCoverageGaps = sourceMetricCoverageGaps.size > 0;
  return {
    providerSymbols,
    cachedMetrics: input.cachedMetrics,
    sourceMetricCoverageGaps,
    warnings: hasCoverageGaps ? ["screener-partial"] : [],
    hasLiveSource: false,
    hasPartialCoverage: hasCoverageGaps,
    hasStaleSource: false,
    observationCount: 0,
    failedSymbolCount: 0,
    missingSymbolCount: 0,
  };
}

export function mergeCachedSourceMetrics(
  cachedMetrics: Map<string, CachedSecurityMetrics>,
  writes: readonly SecurityMetricsInput[],
  capturedAt: string,
): Map<string, CachedSecurityMetrics> {
  if (writes.length === 0) return cachedMetrics;
  const merged = new Map(cachedMetrics);
  for (const write of writes) {
    const existing = merged.get(write.securityId);
    const current: CachedSecurityMetrics = existing
      ? {
          ...existing,
          values: { ...existing.values },
          observedKeys: new Set(existing.observedKeys),
          sourceCapturedAtByKey: new Map(existing.sourceCapturedAtByKey),
          sourceProviderSymbolByKey: new Map(existing.sourceProviderSymbolByKey),
        }
      : {
          securityId: write.securityId,
          providerSymbol: write.providerSymbol,
          values: {},
          capturedAt: "",
          observedKeys: new Set(),
          sourceCapturedAtByKey: new Map(),
          sourceProviderSymbolByKey: new Map(),
        };
    current.providerSymbol = write.providerSymbol;
    if (capturedAt > current.capturedAt) current.capturedAt = capturedAt;
    for (const definition of SOURCE_METRIC_DEFINITIONS) {
      const value = write.values[definition.key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      current.values[definition.key] = value;
      current.observedKeys.add(definition.key);
      current.sourceCapturedAtByKey.set(definition.key, capturedAt);
      current.sourceProviderSymbolByKey.set(definition.key, write.providerSymbol);
    }
    merged.set(write.securityId, current);
  }
  return merged;
}

export async function refreshScreenerMetrics(
  input: RefreshScreenerMetricsInput,
): Promise<RefreshScreenerMetricsResult> {
  const providerSymbols = new Map(input.providerSymbols);
  const sourceMetricCoverageGaps = new Set(input.sourceMetricCoverageGaps);
  if (input.requestedSymbols.length === 0) {
    return emptyResult(input, providerSymbols, sourceMetricCoverageGaps);
  }

  const warnings = new Set<MetricsOverviewWarning>();
  // The database path is constant for this request; reuse it for all
  // negative-cache keys instead of resolving it inside the symbol loops.
  const metricsCachePath = databasePath();
  let cachedMetrics = input.cachedMetrics;
  let hasLiveSource = false;
  let hasPartialCoverage = false;
  let hasStaleSource = false;
  let observationCount = 0;
  let failedSymbolCount = 0;
  let missingSymbolCount = 0;

  try {
    const cachedSecurityIdsBeforeRefresh = new Set(cachedMetrics.keys());
    const providerResult = await fetchTradingViewMetrics([...input.requestedSymbols]);
    const observations = providerResult.observations;
    const bySymbol = new Map(observations.map((observation) => [observation.symbol, observation]));
    const failedSymbols = new Set(providerResult.failedSymbols);
    const missingSymbols = new Set(providerResult.missingSymbols);
    observationCount = observations.length;
    failedSymbolCount = failedSymbols.size;
    missingSymbolCount = missingSymbols.size;
    const capturedAt = new Date().toISOString();
    const capturedAtMs = Date.parse(capturedAt);
    const providerSymbolWrites: ProviderSymbolInput[] = [];
    const metricWrites: SecurityMetricsInput[] = [];
    const negativeCacheWrites: ProviderNegativeCacheEntry[] = [];
    const negativeCacheDeletes: ProviderNegativeCacheEntry[] = [];
    let incompleteSourceMetrics = false;

    for (const symbol of input.requestedSymbols) {
      if (bySymbol.has(symbol) || !missingSymbols.has(symbol) || failedSymbols.has(symbol)) continue;
      for (const definition of SOURCE_METRIC_DEFINITIONS) {
        rememberMissingSourceMetric(
          sourceMetricCacheKey(metricsCachePath, symbol, definition.key),
          input.missingSourceMetricTtlMs,
        );
        negativeCacheWrites.push({
          provider: "tradingview",
          cacheKind: "source_metric",
          providerSymbol: symbol,
          metricKey: definition.key,
          expiresAt: capturedAtMs + input.missingSourceMetricTtlMs,
        });
      }
    }

    for (const holding of input.holdings) {
      if (!input.needsRefresh.has(holding.securityId)) continue;
      const candidates = input.candidatesBySecurity.get(holding.securityId) ?? [];
      const providerRecord = providerSymbols.get(holding.securityId);
      const persisted = resolvedProviderSymbol(providerRecord);
      const candidateDetails = input.candidateDetailsBySecurity?.get(holding.securityId)
        ?? tradingViewSymbolCandidateDetails(holding);
      const candidateDetailsBySymbol = new Map(
        candidateDetails.map((candidate) => [candidate.symbol, candidate]),
      );
      const persistedListingConflict = Boolean(
        persisted &&
        !candidateDetailsBySymbol.has(persisted),
      );
      const selectedMatch = selectBestScreenerMatch(holding.name, candidates, bySymbol);
      const selectedProvenance = selectedMatch
        ? candidateDetailsBySymbol.get(selectedMatch.observation.symbol)?.provenance ?? "cross_exchange"
        : undefined;
      const selectedMatchHasEvidence = selectedMatch
        ? hasSufficientMappingEvidence(
          holding,
          selectedMatch.observation,
          selectedProvenance ?? "country_fallback",
          selectedMatch.score,
        )
        : false;
      if (!selectedMatch || !selectedMatchHasEvidence) {
        if (shouldPreserveUnresolvedMapping(
          providerRecord?.status,
          providerRecord?.metadata,
          candidates,
        )) {
          continue;
        }
        const confirmedMissing = candidatesConfirmedMissing(
          candidates,
          missingSymbols,
          failedSymbols,
        );
        const confirmedConflict = Boolean(selectedMatch) || (
          persistedListingConflict && confirmedMissing
        );
        // Do not turn a failed provider batch into a negative mapping. A
        // mapping can only become unresolved after a confirmed absence (or a
        // returned observation that fails issuer evidence).
        if (!confirmedMissing && !selectedMatch) continue;
        // A returned observation that fails issuer evidence is a confirmed
        // conflict even when its symbol is still in the generated candidates.
        if (shouldInvalidateProviderMapping(
          persisted,
          confirmedConflict,
        )) {
          warnings.add("mapping-unresolved");
          const metadata = {
            candidates,
            candidateProvenance: [...candidateDetailsBySymbol.values()].map((candidate) => ({
              symbol: candidate.symbol,
              provenance: candidate.provenance,
            })),
            ticker: holding.ticker,
            exchange: holding.exchange ?? null,
          };
          providerSymbolWrites.push({
            securityId: holding.securityId,
            providerSymbol: null,
            status: "unresolved",
            confidence: null,
            metadata,
            verifiedAt: capturedAt,
          });
          providerSymbols.set(holding.securityId, {
            securityId: holding.securityId,
            providerSymbol: null,
            status: "unresolved",
            lastVerifiedAt: capturedAt,
            metadata,
          });
        }
        continue;
      }

      const match = selectedMatch;
      const observation = match.observation;
      const provenance = selectedProvenance ?? "cross_exchange";
      const confidence = mappingConfidence(provenance, match.score);
      const selectedCandidate = candidateDetailsBySymbol.get(observation.symbol);
      const metadata = {
        ticker: holding.ticker,
        exchange: holding.exchange ?? null,
        description: observation.description,
        sector: observation.sector,
        alternativesTested: candidates.length,
        candidateProvenance: [...candidateDetailsBySymbol.values()].map((candidate) => ({
          symbol: candidate.symbol,
          provenance: candidate.provenance,
        })),
        mappingProvenance: provenance,
        mappingScore: match.score,
        candidatePosition: selectedCandidate?.symbol === observation.symbol
          ? candidates.indexOf(observation.symbol)
          : null,
      };
      providerSymbolWrites.push({
        securityId: holding.securityId,
        providerSymbol: observation.symbol,
        status: "resolved",
        confidence,
        metadata,
        verifiedAt: capturedAt,
      });
      const observedMetricCount = Object.keys(observation.values).length;
      if (observedMetricCount < SOURCE_METRIC_DEFINITIONS.length) {
        incompleteSourceMetrics = true;
      }
      reconcileSourceMetricCoverageGap(
        sourceMetricCoverageGaps,
        holding.securityId,
        observedMetricCount,
      );
      for (const definition of SOURCE_METRIC_DEFINITIONS) {
        const cacheKey = sourceMetricCacheKey(
          metricsCachePath,
          observation.symbol,
          definition.key,
        );
        if (Object.prototype.hasOwnProperty.call(observation.values, definition.key)) {
          rememberAvailableSourceMetric(cacheKey);
          negativeCacheDeletes.push({
            provider: "tradingview",
            cacheKind: "source_metric",
            providerSymbol: observation.symbol,
            metricKey: definition.key,
            expiresAt: 0,
          });
        } else {
          rememberMissingSourceMetric(cacheKey, input.missingSourceMetricTtlMs);
          negativeCacheWrites.push({
            provider: "tradingview",
            cacheKind: "source_metric",
            providerSymbol: observation.symbol,
            metricKey: definition.key,
            expiresAt: capturedAtMs + input.missingSourceMetricTtlMs,
          });
        }
      }
      if (observedMetricCount > 0) {
        metricWrites.push({
          securityId: holding.securityId,
          providerSymbol: observation.symbol,
          values: observation.values,
        });
      }
      providerSymbols.set(holding.securityId, {
        securityId: holding.securityId,
        providerSymbol: observation.symbol,
        status: "resolved",
        lastVerifiedAt: capturedAt,
        metadata,
      });
    }

    saveProviderSymbolsBatch(providerSymbolWrites);
    saveSecurityMetricsBatch(metricWrites, capturedAt);
    saveProviderNegativeCacheBatch(negativeCacheWrites);
    deleteProviderNegativeCacheBatch(negativeCacheDeletes);
    // A Screener response can resolve mappings while exposing no numeric
    // source fields. The input cache is complete for the existing rows, so
    // merge successful writes locally instead of rereading every security;
    // negative-cache entries mask unavailable fields downstream.
    cachedMetrics = mergeCachedSourceMetrics(cachedMetrics, metricWrites, capturedAt);
    // A failed candidate is a transport problem only when no candidate for
    // the security was resolved by this response. An alias can fail while a
    // different candidate succeeds; that is still a live resolution and
    // must not downgrade the whole result to stale.
    const writtenSecurityIds = new Set(providerSymbolWrites.map((write) => write.securityId));
    const failedSourceSecurityIds = transportFailedSecurityIds(
      input.holdings,
      input.needsRefresh,
      input.candidatesBySecurity,
      failedSymbols,
      writtenSecurityIds,
    );
    const hasUnrefreshedSource = hasUnrefreshedCachedItems(
      failedSourceSecurityIds,
      new Set(metricWrites.map((input) => input.securityId)),
      cachedSecurityIdsBeforeRefresh,
    );
    hasLiveSource = metricWrites.length > 0;
    hasPartialCoverage = incompleteSourceMetrics || missingSymbols.size > 0;
    // A failed batch remains stale even when there was no compatible cached
    // observation for that security. Confirmed missing symbols stay partial;
    // metricsSourceStatus gives stale precedence when both are present.
    hasStaleSource = hasUnrefreshedSource || failedSourceSecurityIds.length > 0;
    if (incompleteSourceMetrics || missingSymbols.size > 0) {
      warnings.add("screener-partial");
    }
    if (hasStaleSource) warnings.add("screener-unavailable");
  } catch (error) {
    if (cachedMetrics.size === 0) {
      throw new ScreenerRefreshUnavailableError(error);
    }
    warnings.add("screener-unavailable");
    hasStaleSource = true;
  }

  if (sourceMetricCoverageGaps.size > 0) {
    hasPartialCoverage = true;
    warnings.add("screener-partial");
  }

  return {
    providerSymbols,
    cachedMetrics,
    sourceMetricCoverageGaps,
    warnings: [...warnings],
    hasLiveSource,
    hasPartialCoverage,
    hasStaleSource,
    observationCount,
    failedSymbolCount,
    missingSymbolCount,
  };
}
