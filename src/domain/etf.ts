export type FundWrapper = "UCITS" | "US_1940_ACT";
export type DistributionPolicy = "Accumulating" | "Distributing";
export type DataStatus = "live" | "fallback";

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
  warning?: string;
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
  sectorComparison: SectorComparison[];
  warnings: string[];
}
