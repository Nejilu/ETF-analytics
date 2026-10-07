import type { PortfolioCashPosition, PortfolioItem } from "./portfolio";

// Read-only valuation shared by the local analysis and the published view.
// Keep editor IDs, initial values and input metadata out of this DTO.
export interface PortfolioHoldingsValuation {
  totalMarketValueUsd: number;
  items: Array<{
    ticker: string;
    name: string;
    kind: "etf" | "security";
    quantity: number | null;
    currentValueUsd: number | null;
    allocationWeight: number;
  }>;
  cash: Array<{
    currency: string;
    amount: number;
    valueUsd: number | null;
    weight: number | null;
  }>;
}

export function portfolioHoldingsValuation(
  totalMarketValueUsd: number,
  items: PortfolioItem[],
  cashPositions: PortfolioCashPosition[],
): PortfolioHoldingsValuation {
  return {
    totalMarketValueUsd,
    items: items.map((item) => ({
      ticker: item.ticker,
      name: item.name,
      kind: item.kind,
      quantity: item.quantity ?? null,
      currentValueUsd: item.currentValueUsd ?? null,
      allocationWeight: item.allocationWeight,
    })),
    cash: cashPositions.map((position) => ({
      currency: position.currency,
      amount: position.amount,
      valueUsd: position.valueUsd ?? null,
      weight: position.valueUsd !== undefined
        ? position.valueUsd / totalMarketValueUsd * 100
        : null,
    })),
  };
}

export function portfolioPositionValueUsd(
  publishedWeight: number,
  valuation: PortfolioHoldingsValuation,
): number {
  // Display weights may exclude cash or be normalized. Amounts always use NAV.
  return publishedWeight / 100 * valuation.totalMarketValueUsd;
}
