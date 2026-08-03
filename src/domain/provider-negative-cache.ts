export type NegativeCacheState = "absent" | "fresh" | "expired";

class BoundedNegativeCache {
  private readonly entries = new Map<string, number>();

  constructor(private readonly maxEntries: number) {}

  state(key: string, now = Date.now()): NegativeCacheState {
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return "absent";
    if (expiresAt > now) return "fresh";
    this.entries.delete(key);
    return "expired";
  }

  rememberMissing(key: string, ttlMs: number, now = Date.now()): void {
    // Setting an existing Map key does not refresh its insertion order. Move
    // renewed entries to the back so the bounded cache evicts the true oldest
    // negative result instead of a recently revalidated one.
    this.entries.delete(key);
    this.entries.set(key, now + ttlMs);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  rememberAvailable(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

const missingEstimateSeries = new BoundedNegativeCache(5_000);
const missingSourceMetrics = new BoundedNegativeCache(10_000);

export function estimateSeriesCacheKey(databasePath: string, providerSymbol: string): string {
  return `${databasePath}::${providerSymbol}`;
}

export function estimateSeriesMissingState(key: string, now = Date.now()): NegativeCacheState {
  return missingEstimateSeries.state(key, now);
}

export function rememberMissingEstimateSeries(key: string, ttlMs: number, now = Date.now()): void {
  missingEstimateSeries.rememberMissing(key, ttlMs, now);
}

export function rememberAvailableEstimateSeries(key: string): void {
  missingEstimateSeries.rememberAvailable(key);
}

export function clearMissingEstimateSeriesCache(): void {
  missingEstimateSeries.clear();
}

export function sourceMetricCacheKey(
  databasePath: string,
  providerSymbol: string,
  metricKey: string,
): string {
  return `${databasePath}::${providerSymbol}::${metricKey}`;
}

export function sourceMetricMissingState(key: string, now = Date.now()): NegativeCacheState {
  return missingSourceMetrics.state(key, now);
}

export function rememberMissingSourceMetric(key: string, ttlMs: number, now = Date.now()): void {
  missingSourceMetrics.rememberMissing(key, ttlMs, now);
}

export function rememberAvailableSourceMetric(key: string): void {
  missingSourceMetrics.rememberAvailable(key);
}

export function clearMissingSourceMetricCache(): void {
  missingSourceMetrics.clear();
}
