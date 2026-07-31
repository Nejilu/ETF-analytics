import type { HoldingsSnapshot } from "./etf";

export type PortfolioAssetKind = "etf" | "security";

export interface PortfolioItem {
  id: string;
  kind: PortfolioAssetKind;
  referenceId: string;
  ticker: string;
  name: string;
  allocationWeight: number;
}

export interface PortfolioSecurity {
  securityId: string;
  ticker: string;
  name: string;
  sector: string;
  assetClass: string;
  country: string;
}

export interface PortfolioContribution {
  itemId: string;
  ticker: string;
  kind: PortfolioAssetKind;
  weight: number;
}

export interface PortfolioLookThroughPosition extends PortfolioSecurity {
  weight: number;
  contributions: PortfolioContribution[];
}

export interface PortfolioSectorExposure {
  sector: string;
  weight: number;
}

export interface PortfolioSource {
  ticker: string;
  asOf: string;
  sourceStatus: HoldingsSnapshot["sourceStatus"];
}

export interface PortfolioAnalysis {
  calculatedAt: string;
  allocationWeight: number;
  cashWeight: number;
  positionsCount: number;
  directPositionsCount: number;
  etfSleevesCount: number;
  top10Concentration: number;
  positions: PortfolioLookThroughPosition[];
  sectors: PortfolioSectorExposure[];
  sources: PortfolioSource[];
}

export interface PortfolioRecord {
  id: string;
  name: string;
  baseCurrency: string;
  updatedAt: string;
  items: PortfolioItem[];
  analysis: PortfolioAnalysis | null;
  analysisError?: string;
}

export interface PortfolioAnalysisInput {
  items: PortfolioItem[];
  etfSnapshots: Map<string, HoldingsSnapshot>;
  directSecurities: Map<string, PortfolioSecurity>;
  calculatedAt?: string;
}
