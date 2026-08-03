import type { MetricsOverviewResult, SecurityEstimateSeries } from "./metrics";

export function metricsSourceStatus(
  hasStaleSource: boolean,
  hasPartialCoverage: boolean,
  hasLiveSource: boolean,
): MetricsOverviewResult["sourceStatus"] {
  if (hasStaleSource) return "stale";
  if (hasPartialCoverage) return "partial";
  return hasLiveSource ? "live" : "cached";
}

export function isValidEstimateSeries(value: unknown): value is SecurityEstimateSeries {
  if (!value || typeof value !== "object") return false;
  const series = value as Partial<SecurityEstimateSeries>;
  if (typeof series.providerSymbol !== "string" || series.providerSymbol.trim().length === 0) return false;
  if (typeof series.currency !== "string" || series.currency.trim().length === 0) return false;
  if (typeof series.price !== "number" || !Number.isFinite(series.price) || series.price <= 0) return false;
  if (!Array.isArray(series.points) || series.points.length !== 8) return false;
  if (!series.points.slice(0, 4).every((point) => point?.isHistorical === true)) return false;
  if (!series.points.slice(4).every((point) => point?.isHistorical === false)) return false;
  const fiscalPeriods = series.points.map((point) =>
    point && typeof point === "object" && typeof point.fiscalPeriod === "string"
      ? point.fiscalPeriod.trim()
      : "",
  );
  return new Set(fiscalPeriods).size === 8 && fiscalPeriods.every(Boolean) &&
    series.points.every((point) => {
      if (!point || typeof point !== "object") return false;
      const candidate = point as SecurityEstimateSeries["points"][number];
      return typeof candidate.estimate === "number" && Number.isFinite(candidate.estimate) &&
        typeof candidate.isHistorical === "boolean" &&
        (candidate.estimateDate === null ||
          (typeof candidate.estimateDate === "string" && Number.isFinite(Date.parse(candidate.estimateDate)))) &&
        (candidate.analystCount === null ||
          (typeof candidate.analystCount === "number" &&
            Number.isFinite(candidate.analystCount) &&
            candidate.analystCount >= 0));
    });
}

export function needsEstimateSeriesRefresh(
  cachedProviderSymbol: string | undefined,
  currentProviderSymbol: string,
  capturedAt: string | undefined,
  ttlSeconds: number,
  now = Date.now(),
): boolean {
  if (cachedProviderSymbol !== currentProviderSymbol) return true;
  if (!capturedAt) return true;
  const timestamp = Date.parse(capturedAt);
  return !Number.isFinite(timestamp) || now - timestamp >= ttlSeconds * 1_000;
}

export function isEstimateSeriesCompatible(
  cachedProviderSymbol: string | undefined,
  currentProviderSymbol: string | undefined,
): boolean {
  return Boolean(
    cachedProviderSymbol &&
    currentProviderSymbol &&
    cachedProviderSymbol === currentProviderSymbol,
  );
}

export function isSourceMetricsCompatible(
  cachedProviderSymbol: string | null | undefined,
  currentProviderSymbol: string | null | undefined,
): boolean {
  return Boolean(
    cachedProviderSymbol &&
    currentProviderSymbol &&
    cachedProviderSymbol === currentProviderSymbol,
  );
}

export function resolvedProviderSymbol(
  record: { status?: string; providerSymbol?: string | null } | undefined,
): string | undefined {
  const symbol = record?.providerSymbol?.trim();
  return record?.status === "resolved" && symbol
    ? symbol
    : undefined;
}

export function shouldUseCachedSourceMetric(
  cachedProviderSymbol: string | null | undefined,
  currentProviderSymbol: string | null | undefined,
  missingNow: boolean,
): boolean {
  return isSourceMetricsCompatible(cachedProviderSymbol, currentProviderSymbol) && !missingNow;
}

export function hasUnrefreshedCachedItems(
  requestedIds: readonly string[],
  refreshedIds: ReadonlySet<string>,
  cachedIds: ReadonlySet<string>,
): boolean {
  return requestedIds.some((id) => cachedIds.has(id) && !refreshedIds.has(id));
}

export function hasUnresolvedRefreshCandidates(
  requestedIds: readonly string[],
  candidatesById: ReadonlyMap<string, readonly string[]>,
): boolean {
  return requestedIds.some((id) => (candidatesById.get(id)?.length ?? 0) === 0);
}

export function providerCandidatesMatch(
  metadata: Record<string, unknown> | null | undefined,
  candidates: readonly string[],
): boolean {
  const stored = metadata?.candidates;
  return Array.isArray(stored) &&
    stored.length === candidates.length &&
    stored.every((candidate, index) => candidate === candidates[index]);
}

export function shouldPreserveUnresolvedMapping(
  status: string | undefined,
  metadata: Record<string, unknown> | null | undefined,
  candidates: readonly string[],
): boolean {
  return status === "unresolved" &&
    candidates.length === 0 &&
    Array.isArray(metadata?.candidates);
}

export function shouldRetryUnresolvedMapping(
  status: string | undefined,
  lastVerifiedAt: string | undefined,
  metadata: Record<string, unknown> | null | undefined,
  candidates: readonly string[],
  ttlSeconds: number,
  now = Date.now(),
): boolean {
  if (status !== "unresolved") return false;
  if (!providerCandidatesMatch(metadata, candidates)) return true;
  const timestamp = Date.parse(lastVerifiedAt ?? "");
  return !Number.isFinite(timestamp) || now - timestamp >= ttlSeconds * 1_000;
}

/**
 * A compatible cached mapping remains a useful stale fallback when a provider
 * batch is unavailable. A mapping that conflicts with the current candidate
 * set must instead be cleared before Estimates run.
 */
export function shouldInvalidateProviderMapping(
  existingProviderSymbol: string | null | undefined,
  candidateConflict: boolean,
): boolean {
  return candidateConflict || !existingProviderSymbol;
}
