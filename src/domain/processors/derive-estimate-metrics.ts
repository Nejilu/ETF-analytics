import { DERIVED_METRIC_KEYS, type MetricKey, type SecurityEstimateSeries } from "@/domain/metrics";

const WINDOW_KEYS = [
  "pe_estimate_window_0",
  "pe_estimate_window_1",
  "pe_estimate_window_2",
  "pe_estimate_window_3",
  "pe_estimate_window_4",
] as const satisfies readonly MetricKey[];

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function deriveEstimateSeriesMetrics(
  series: SecurityEstimateSeries,
): Partial<Record<MetricKey, number>> {
  if (series.points.length !== 8 || !positive(series.price)) return {};
  const estimates = series.points.map((point) => point.estimate);
  if (estimates.some((estimate) => !Number.isFinite(estimate))) return {};
  const values: Partial<Record<MetricKey, number>> = {};

  WINDOW_KEYS.forEach((key, index) => {
    const fourQuarterEps = estimates
      .slice(index, index + 4)
      .reduce((sum, estimate) => sum + estimate, 0);
    if (positive(fourQuarterEps)) values[key] = series.price / fourQuarterEps;
  });

  const historical = estimates.slice(0, 4).reduce((sum, estimate) => sum + estimate, 0);
  const forward = estimates.slice(4, 8).reduce((sum, estimate) => sum + estimate, 0);
  if (positive(historical) && positive(forward)) {
    values.eps_growth_estimate_forward_4q = (forward / historical - 1) * 100;
  }
  return values;
}

/**
 * A fresh consensus series is authoritative for derived EPS/P-E fields. If a
 * new series makes one of those fields undefined (for example, a non-positive
 * four-quarter EPS sum), remove the prior cached value instead of carrying it
 * forward with a misleading timestamp.
 */
export function replaceDerivedMetrics(
  values: Partial<Record<MetricKey, number>>,
  derived: Partial<Record<MetricKey, number>>,
): Partial<Record<MetricKey, number>> {
  const result = { ...values };
  for (const key of DERIVED_METRIC_KEYS) delete result[key];
  return { ...result, ...derived };
}
