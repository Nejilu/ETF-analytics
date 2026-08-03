import { METRIC_DEFINITIONS, type SecurityMetricValues, type WeightedMetric } from "@/domain/metrics";
import type { Holding } from "@/domain/etf";

const EARNINGS_GROWTH_KEY = "eps_growth_estimate_forward_4q";

function aggregateEarningsYieldGrowth(
  eligible: Holding[],
  totalWeight: number,
  metricsBySecurity: ReadonlyMap<string, SecurityMetricValues>,
): WeightedMetric {
  const covered = eligible.flatMap((holding) => {
    const values = metricsBySecurity.get(holding.securityId)?.values;
    const historicalPe = values?.pe_estimate_window_0;
    const forwardPe = values?.pe_estimate_window_4;
    return typeof historicalPe === "number" && Number.isFinite(historicalPe) && historicalPe > 0 &&
      typeof forwardPe === "number" && Number.isFinite(forwardPe) && forwardPe > 0
      ? [{ holding, historicalPe, forwardPe }]
      : [];
  });
  const coveredWeight = covered.reduce((sum, item) => sum + item.holding.weight, 0);
  const historicalEarningsYield = covered.reduce(
    (sum, item) => sum + item.holding.weight / item.historicalPe,
    0,
  );
  const forwardEarningsYield = covered.reduce(
    (sum, item) => sum + item.holding.weight / item.forwardPe,
    0,
  );
  const value = historicalEarningsYield > 0 && forwardEarningsYield >= 0
    ? (forwardEarningsYield / historicalEarningsYield - 1) * 100
    : null;
  return {
    key: EARNINGS_GROWTH_KEY,
    value: value !== null && Number.isFinite(value) ? value : null,
    coverageWeight: totalWeight > 0 ? (coveredWeight / totalWeight) * 100 : 0,
    coveredHoldings: covered.length,
    totalHoldings: eligible.length,
  };
}

export function aggregateEtfMetrics(
  holdings: Holding[],
  metricsBySecurity: ReadonlyMap<string, SecurityMetricValues>,
): WeightedMetric[] {
  const eligible = holdings.filter((holding) => holding.weight > 0 && holding.assetClass.toLowerCase().includes("equity"));
  const totalWeight = eligible.reduce((sum, holding) => sum + holding.weight, 0);
  return METRIC_DEFINITIONS.filter((definition) => definition.aggregate).map((definition) => {
    if (definition.key === EARNINGS_GROWTH_KEY) {
      return aggregateEarningsYieldGrowth(eligible, totalWeight, metricsBySecurity);
    }
    const covered = eligible.flatMap((holding) => {
      const value = metricsBySecurity.get(holding.securityId)?.values[definition.key];
      const inRange = !definition.validRange || (
        typeof value === "number" &&
        value >= definition.validRange.min &&
        value <= definition.validRange.max
      );
      const validForAggregation = definition.aggregation !== "weighted_harmonic" || (
        typeof value === "number" && value > 0
      );
      return typeof value === "number" && Number.isFinite(value) && inRange && validForAggregation
        ? [{ holding, value }]
        : [];
    });
    const coveredWeight = covered.reduce((sum, item) => sum + item.holding.weight, 0);
    const weightedValue = definition.aggregation === "weighted_harmonic"
      ? coveredWeight / covered.reduce((sum, item) => sum + item.holding.weight / item.value, 0)
      : covered.reduce((sum, item) => sum + item.value * item.holding.weight, 0) / coveredWeight;
    return {
      key: definition.key,
      value: coveredWeight > 0 && Number.isFinite(weightedValue) ? weightedValue : null,
      coverageWeight: totalWeight > 0 ? (coveredWeight / totalWeight) * 100 : 0,
      coveredHoldings: covered.length,
      totalHoldings: eligible.length,
    };
  });
}
