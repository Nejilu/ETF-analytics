export type FundWrapper = "UCITS" | "US_1940_ACT" | "SYNTHETIC";
export type DistributionPolicy =
  | "Accumulating"
  | "Distributing"
  | "Look-through";
export type EtfFundType = "physical" | "portfolio";
export type DataStatus = "live" | "cached" | "stale";

export interface Benchmark {
  id: string;
  name: string;
  provider: string;
  region: string;
  description: string;
}

export interface EtfShareClass {
  id: string;
  ticker: string;
  name: string;
  benchmarkId: string;
  isin: string;
  wrapper: FundWrapper;
  domicile: string;
  exchange: string;
  tradingCurrency: string;
  distributionPolicy: DistributionPolicy;
  ter: number;
  productUrl: string;
  holdingsUrl: string;
  fundType?: EtfFundType;
  portfolioId?: string;
  description?: string;
}

export interface CatalogGroup extends Benchmark {
  variants: EtfShareClass[];
}

export interface Holding {
  securityId: string;
  ticker: string;
  name: string;
  sector: string;
  assetClass: string;
  country: string;
  isin?: string;
  weight: number;
  marketValue?: number;
  currency?: string;
}

export interface HoldingsSnapshot {
  etf: EtfShareClass;
  asOf: string;
  fetchedAt: string;
  sourceStatus: DataStatus;
  sourceUrl: string;
  cacheTtlHours: number;
  holdings: Holding[];
}

export interface SleevePosition {
  securityId: string;
  ticker: string;
  name: string;
  sector: string;
  leftWeight: number;
  overlapWeight: number;
  rightWeight: number;
  leftActiveWeight: number;
  rightActiveWeight: number;
}

export interface ImplicitSleevePosition {
  securityId: string;
  ticker: string;
  name: string;
  sector: string;
  activeWeight: number;
  normalizedWeight: number;
}

export interface ImplicitSleeve {
  sourceTicker: string;
  relativeToTicker: string;
  sourceActiveWeight: number;
  positionsCount: number;
  top10Concentration: number;
  positions: ImplicitSleevePosition[];
}

export interface SectorComparison {
  sector: string;
  left: number;
  right: number;
  delta: number;
}

export interface ComparisonResult {
  left: {
    etf: EtfShareClass;
    asOf: string;
    sourceStatus: DataStatus;
    holdingsCount: number;
    top10Concentration: number;
  };
  right: {
    etf: EtfShareClass;
    asOf: string;
    sourceStatus: DataStatus;
    holdingsCount: number;
    top10Concentration: number;
  };
  calculatedAt: string;
  cacheTtlHours: number;
  overlapWeight: number;
  leftActiveWeight: number;
  rightActiveWeight: number;
  sharedPositionsCount: number;
  positions: SleevePosition[];
  implicitSleeves: {
    left: ImplicitSleeve;
    right: ImplicitSleeve;
  };
  sectorComparison: SectorComparison[];
}
