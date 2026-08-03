export function holdingsRefreshCacheKey(
  databasePath: string,
  normalizedReference: string,
  etfId?: string,
): string {
  return `${databasePath}::${etfId ?? normalizedReference.trim().toUpperCase()}`;
}
