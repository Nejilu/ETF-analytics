import { METRIC_DEFINITIONS, type SecurityMetricValues, type WeightedMetric } from "@/domain/metrics";
import type { Holding } from "@/domain/etf";

export function aggregateEtfMetrics(
  holdings: Holding[],
  metricsBySecurity: ReadonlyMap<string, SecurityMetricValues>,
): WeightedMetric[] {
  const eligible = holdings.filter((holding) => holding.weight > 0 && holding.assetClass.toLowerCase().includes("equity"));
  const totalWeight = eligible.reduce((sum, holding) => sum + holding.weight, 0);
  return METRIC_DEFINITIONS.filter((definition) => definition.aggregate).map((definition) => {
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
