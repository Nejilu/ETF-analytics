export type MetricsOverviewErrorStatus = 400 | 500 | 503;

export function metricsOverviewErrorStatus(
  unavailable: boolean,
  invalidRequest: boolean,
): MetricsOverviewErrorStatus {
  if (invalidRequest) return 400;
  if (unavailable) return 503;
  return 500;
}
