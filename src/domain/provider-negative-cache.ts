export type NegativeCacheState = "absent" | "fresh" | "expired";

export class BoundedNegativeCache {
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

export const estimateSeriesNegativeCache = new BoundedNegativeCache(5_000);
export const sourceMetricNegativeCache = new BoundedNegativeCache(10_000);

export function providerNegativeCacheKey(
  databasePath: string,
  providerSymbol: string,
  metricKey = "",
): string {
  return metricKey
    ? `${databasePath}::${providerSymbol}::${metricKey}`
    : `${databasePath}::${providerSymbol}`;
}
