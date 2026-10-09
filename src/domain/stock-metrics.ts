import type { Holding } from "./etf";
import type { ConsensusHorizon, MetricsOverviewResult, SecurityMetricValues } from "./metrics";
import type { DerivedConsensusWindow } from "./processors/derive-estimate-metrics";
import type { UpcomingEarningsView } from "./upcoming-earnings";

export type StockMetricsMetadata = Omit<MetricsOverviewResult, "etfs" | "holdingsSourceIssues">;

export interface StockMetricsResult extends StockMetricsMetadata {
  security: Omit<Holding, "weight" | "marketValue">;
  observations: SecurityMetricValues;
  upcomingEarnings: UpcomingEarningsView;
  consensusWindows: Record<ConsensusHorizon, DerivedConsensusWindow | null>;
}
