import type { PortfolioRecord } from "./portfolio";
import type { HoldingsAnalysisPosition } from "./holdings-analysis";
import type { UpcomingEarningsView } from "./upcoming-earnings";

export const PORTFOLIO_EVENT_POSITIONS_LIMIT = 10;
export const PORTFOLIO_EVENT_POSITIONS_MAX = 30;

export interface PortfolioEventPosition {
  adrPremiumPairId?: import("./adr-premium").AdrPairId;
  securityId: string;
  ticker: string;
  name: string;
  weight: number;
}

export interface SecurityEarningsEvent extends UpcomingEarningsView {
  securityId: string;
  ticker: string;
  name: string;
}

export function selectPortfolioEventPositions(portfolio: PortfolioRecord, limit = PORTFOLIO_EVENT_POSITIONS_LIMIT): PortfolioEventPosition[] {
  const positions = portfolio.analysis
    ? portfolio.analysis.positions.filter((position) => position.assetClass.toLowerCase().includes("equity")).map((position) => ({
        securityId: position.quoteSecurityId ?? position.securityId,
        ticker: position.quoteTicker ?? position.ticker,
        name: position.name,
        weight: position.weight,
        ...(position.adrPremiumPairId ? { adrPremiumPairId: position.adrPremiumPairId } : {}),
      }))
    : portfolio.items.filter((item) => item.kind === "security").map((item) => ({
        securityId: item.referenceId, ticker: item.ticker, name: item.name, weight: item.allocationWeight,
      }));
  return selectEventPositions(positions, limit);
}

export function selectHoldingsEventPositions(
  holdings: readonly Pick<HoldingsAnalysisPosition, "securityId" | "quoteSecurityId" | "quoteTicker" | "ticker" | "name" | "assetClass" | "isCash" | "publishedWeight" | "adrPremiumPairId">[],
  limit = PORTFOLIO_EVENT_POSITIONS_LIMIT,
): PortfolioEventPosition[] {
  return selectEventPositions(holdings
    .filter((position) => !position.isCash && position.assetClass.toLowerCase().includes("equity"))
    .map((position) => ({
      securityId: position.quoteSecurityId ?? position.securityId,
      ticker: position.quoteTicker ?? position.ticker, name: position.name, weight: position.publishedWeight,
      ...(position.adrPremiumPairId ? { adrPremiumPairId: position.adrPremiumPairId } : {}),
    })), limit);
}

function selectEventPositions(positions: PortfolioEventPosition[], limit: number): PortfolioEventPosition[] {
  const byId = new Map<string, PortfolioEventPosition>();
  for (const position of positions) {
    if (!Number.isFinite(position.weight) || position.weight === 0) continue;
    const existing = byId.get(position.securityId);
    if (existing) existing.weight += position.weight;
    else byId.set(position.securityId, { ...position });
  }
  return [...byId.values()].filter((position) => position.weight !== 0)
    .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight) || left.ticker.localeCompare(right.ticker))
    .slice(0, Math.min(limit, PORTFOLIO_EVENT_POSITIONS_MAX));
}

export function orderEarningsEvents(events: SecurityEarningsEvent[]): SecurityEarningsEvent[] {
  return [...events].sort((left, right) =>
    (left.reportDate ?? "9999-12-31").localeCompare(right.reportDate ?? "9999-12-31")
    || left.ticker.localeCompare(right.ticker));
}
