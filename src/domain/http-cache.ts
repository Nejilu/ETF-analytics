export type SourceStatus = "live" | "cached" | "stale";

export function cacheControlForSource(
  status: SourceStatus,
  freshHeader: string,
): string {
  return status === "stale" ? "no-store" : freshHeader;
}
