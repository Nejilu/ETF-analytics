import type { Holding, HoldingsSnapshot } from "@/domain/etf";
import type {
  ComponentValuationView,
  EtfMetricsOverview,
  SecurityMetricValues,
} from "@/domain/metrics";
import { aggregateEtfMetrics } from "@/domain/processors/aggregate-etf-metrics";

const COMPONENT_POINT_LIMIT = 500;

export function equityHoldings(holdings: Holding[]): Holding[] {
  return holdings.filter((holding) =>
    holding.weight > 0 && holding.assetClass.toLocaleLowerCase("en-US").includes("equity"));
}

export function uniqueEquityHoldings(snapshots: HoldingsSnapshot[]): Holding[] {
  const result = new Map<string, Holding>();
  for (const snapshot of snapshots) {
    for (const holding of equityHoldings(snapshot.holdings)) {
      const current = result.get(holding.securityId);
      if (!current || (!current.exchange && holding.exchange)) {
        result.set(holding.securityId, holding);
      }
    }
  }
  return [...result.values()];
}

export function latestTimestamp(values: Iterable<string | undefined>): string {
  let latest = 0;
  for (const value of values) {
    const timestamp = Date.parse(value ?? "");
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
  }
  return latest > 0 ? new Date(latest).toISOString() : new Date().toISOString();
}

export function buildComponentValuation(
  holdings: Holding[],
  metricsBySecurity: ReadonlyMap<string, SecurityMetricValues>,
): ComponentValuationView {
  const eligibleHoldings = equityHoldings(holdings);
  const totalWeight = eligibleHoldings.reduce((sum, holding) => sum + holding.weight, 0);
  const eligiblePoints = eligibleHoldings.flatMap((holding) => {
    const securityMetrics = metricsBySecurity.get(holding.securityId);
    const peHistoricalEstimate4q = securityMetrics?.values.pe_estimate_window_0;
    const peForwardEstimate4q = securityMetrics?.values.pe_estimate_window_4;
    const epsGrowthEstimate4q = securityMetrics?.values.eps_growth_estimate_forward_4q;
    const series = securityMetrics?.estimateSeries;
    if (
      !securityMetrics || !series ||
      !Number.isFinite(peHistoricalEstimate4q) ||
      !Number.isFinite(peForwardEstimate4q) ||
      !Number.isFinite(epsGrowthEstimate4q)
    ) {
      return [];
    }
    const historicalEstimateSum = series.points
      .slice(0, 4)
      .reduce((sum, point) => sum + point.estimate, 0);
    const forwardEstimateSum = series.points
      .slice(4, 8)
      .reduce((sum, point) => sum + point.estimate, 0);
    return [{
      securityId: holding.securityId,
      ticker: holding.ticker,
      name: holding.name,
      sector: holding.sector,
      country: holding.country,
      providerSymbol: securityMetrics.providerSymbol,
      weight: holding.weight,
      peHistoricalEstimate4q: peHistoricalEstimate4q as number,
      peForwardEstimate4q: peForwardEstimate4q as number,
      epsGrowthEstimate4q: epsGrowthEstimate4q as number,
      historicalEstimateSum,
      forwardEstimateSum,
      price: series.price,
      currency: series.currency,
      estimatePoints: series.points,
    }];
  });
  const validPoints = eligiblePoints.filter((point) => point.peForwardEstimate4q > 0);
  const points = validPoints
    .sort((left, right) => right.weight - left.weight)
    .slice(0, COMPONENT_POINT_LIMIT);
  const representedWeight = points.reduce((sum, point) => sum + point.weight, 0);
  const minGrowth = points.length
    ? Math.min(-10, Math.floor(Math.min(...points.map((point) => point.epsGrowthEstimate4q)) / 10) * 10)
    : -10;
  const maxGrowth = points.length
    ? Math.max(30, Math.ceil(Math.max(...points.map((point) => point.epsGrowthEstimate4q)) / 10) * 10)
    : 30;
  const maxPe = points.length
    ? Math.max(30, Math.ceil(Math.max(...points.map((point) => point.peForwardEstimate4q)) / 10) * 10)
    : 30;
  return {
    points,
    eligibleCount: eligiblePoints.length,
    eligibleHoldingCount: eligibleHoldings.length,
    displayedCount: points.length,
    excludedOutlierCount: 0,
    missingMetricCount: eligibleHoldings.length - eligiblePoints.length,
    excludedNonPositivePeCount: eligiblePoints.length - validPoints.length,
    truncatedCount: Math.max(0, validPoints.length - points.length),
    representedWeight: totalWeight > 0 ? (representedWeight / totalWeight) * 100 : 0,
    axisLimits: { minGrowth, maxGrowth, maxPe },
  };
}

export function buildEtfMetricsOverview(
  snapshot: HoldingsSnapshot,
  resolvedSecurityIds: ReadonlySet<string>,
  metricsBySecurity: ReadonlyMap<string, SecurityMetricValues>,
): EtfMetricsOverview {
  const eligible = equityHoldings(snapshot.holdings);
  const totalWeight = eligible.reduce((sum, holding) => sum + holding.weight, 0);
  const mapped = eligible.filter((holding) => resolvedSecurityIds.has(holding.securityId));
  const mappedWeight = mapped.reduce((sum, holding) => sum + holding.weight, 0);
  return {
    etfId: snapshot.etf.id,
    ticker: snapshot.etf.ticker,
    name: snapshot.etf.name,
    asOf: snapshot.asOf,
    holdingsCount: eligible.length,
    mappedHoldings: mapped.length,
    mappingCoverageWeight: totalWeight > 0 ? (mappedWeight / totalWeight) * 100 : 0,
    metrics: aggregateEtfMetrics(snapshot.holdings, metricsBySecurity),
    componentValuation: buildComponentValuation(snapshot.holdings, metricsBySecurity),
  };
}
