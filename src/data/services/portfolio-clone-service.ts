import "server-only";
import { randomUUID } from "node:crypto";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { findEtfById } from "@/db/repositories/catalog-repository";
import { isCashHolding } from "@/domain/cash-holdings";
import { mapWithConcurrency } from "@/domain/async-utils";
import { normalizeHoldingWeights } from "@/domain/processors/normalize-holding-weights";
import { buildCloneAllocation, validateCloneDraft, PortfolioCloneRequestError, type CloneSourceComposition, type PortfolioCloneDraft, type PortfolioCloneResult } from "@/domain/portfolio-clone";
import { getHoldingsSnapshot } from "./holdings-service";
import { getFxRate } from "./market-price-service";
import { getPortfolioById, previewPortfolio, PortfolioUnavailableError } from "./portfolio-service";

async function sourceComposition(id: string): Promise<CloneSourceComposition> {
  const etf = findEtfById(id);
  if (!etf) throw new PortfolioCloneRequestError("One of the selected sources no longer exists.");
  if (etf.fundType === "portfolio") {
    if (!etf.portfolioId) throw new PortfolioCloneRequestError("The source portfolio is unavailable.");
    const portfolio = await getPortfolioById(etf.portfolioId);
    if (!portfolio.analysis || portfolio.priceError || portfolio.analysisError) throw new PortfolioUnavailableError(portfolio.priceError ?? portfolio.analysisError ?? "The source portfolio composition is unavailable.");
    return { id, ticker: etf.ticker, name: etf.name, asOf: portfolio.analysis.calculatedAt,
      positions: portfolio.analysis.positions.filter((position) => !isCashHolding(position)).map((position) => ({ securityId: position.quoteSecurityId ?? position.securityId, weight: position.weight })) };
  }
  const snapshot = await getHoldingsSnapshot(id);
  const positions = normalizeHoldingWeights(snapshot.holdings, etf.exposureMultiplier ?? 1).filter((position) => !isCashHolding(position));
  if (!positions.length) throw new PortfolioUnavailableError(`No usable security holdings are available for ${etf.ticker}.`);
  return { id, ticker: etf.ticker, name: etf.name, asOf: snapshot.asOf, positions: positions.map((position) => ({ securityId: position.securityId, weight: position.weight })) };
}

export async function clonePortfolio(draft: PortfolioCloneDraft): Promise<PortfolioCloneResult> {
  validateCloneDraft(draft);
  ensureLocalDatabase();
  const [sources, fx] = await Promise.all([
    mapWithConcurrency(draft.sources, 3, (source) => sourceComposition(source.sourceId)),
    getFxRate(draft.currency),
  ]);
  const allocation = buildCloneAllocation(draft, sources, fx.rateToUsd);
  const portfolio = await previewPortfolio(allocation.positions.map((position) => ({
    id: randomUUID(), kind: "security", referenceId: position.securityId, inputMode: "value", inputAmount: position.valueUsd,
  })), allocation.cashAmount === 0 ? [] : [{ currency: draft.currency, amount: allocation.cashAmount }]);
  return { portfolio, clonedAt: new Date().toISOString(), amount: draft.amount, currency: draft.currency, sources: allocation.sources };
}
