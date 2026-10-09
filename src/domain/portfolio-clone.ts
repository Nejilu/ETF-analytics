import { MAX_PORTFOLIO_ITEMS, SUPPORTED_CASH_CURRENCIES, type PortfolioCashCurrency, type PortfolioRecord } from "./portfolio";

export interface PortfolioCloneDraft {
  amount: number;
  currency: PortfolioCashCurrency;
  sources: Array<{ sourceId: string; allocation: number }>;
}
export interface CloneSourceComposition {
  id: string;
  ticker: string;
  name: string;
  asOf: string;
  positions: Array<{ securityId: string; weight: number }>;
}
export interface PortfolioCloneResult {
  portfolio: PortfolioRecord;
  clonedAt: string;
  currency: PortfolioCashCurrency;
  amount: number;
  sources: Array<{ sourceId: string; ticker: string; name: string; asOf: string; allocation: number; amount: number }>;
}
export class PortfolioCloneRequestError extends Error {}

export function validateCloneDraft(draft: PortfolioCloneDraft): void {
  if (!draft || typeof draft !== "object" || !Number.isFinite(draft.amount) || draft.amount <= 0) throw new PortfolioCloneRequestError("Enter a positive portfolio amount.");
  if (!SUPPORTED_CASH_CURRENCIES.includes(draft.currency)) throw new PortfolioCloneRequestError("Select a supported portfolio currency.");
  if (!Array.isArray(draft.sources) || !draft.sources.length || draft.sources.length > 10) throw new PortfolioCloneRequestError("Select between 1 and 10 sources to clone.");
  const seen = new Set<string>();
  let total = 0;
  for (const source of draft.sources) {
    if (!source || typeof source.sourceId !== "string" || !source.sourceId || source.sourceId.length > 100) throw new PortfolioCloneRequestError("Select a source for each allocation.");
    if (seen.has(source.sourceId)) throw new PortfolioCloneRequestError("Each source can only be selected once.");
    seen.add(source.sourceId);
    if (!Number.isFinite(source.allocation) || source.allocation <= 0 || source.allocation > 100) throw new PortfolioCloneRequestError("Each allocation must be greater than 0% and at most 100%.");
    total += source.allocation;
  }
  if (total > 100 + 1e-8) throw new PortfolioCloneRequestError("Source allocations cannot exceed 100%. The remainder is kept as cash.");
}

// Materialize security exposures, never references to the source funds.
export function buildCloneAllocation(draft: PortfolioCloneDraft, sources: CloneSourceComposition[], rateToUsd: number) {
  validateCloneDraft(draft);
  if (!Number.isFinite(rateToUsd) || rateToUsd <= 0 || !Number.isFinite(draft.amount * rateToUsd)) throw new PortfolioCloneRequestError("The exchange rate is unavailable.");
  const values = new Map<string, number>();
  const summaries = draft.sources.map((allocation) => {
    const source = sources.find((candidate) => candidate.id === allocation.sourceId);
    if (!source) throw new PortfolioCloneRequestError("One of the selected sources is unavailable.");
    for (const position of source.positions) {
      if (!position.securityId || !Number.isFinite(position.weight)) throw new PortfolioCloneRequestError(`The composition of ${source.ticker} is invalid.`);
      const value = draft.amount * rateToUsd * allocation.allocation / 100 * position.weight / 100;
      values.set(position.securityId, (values.get(position.securityId) ?? 0) + value);
    }
    return { sourceId: source.id, ticker: source.ticker, name: source.name, asOf: source.asOf, allocation: allocation.allocation, amount: draft.amount * allocation.allocation / 100 };
  });
  const positions = [...values].filter(([, valueUsd]) => Math.abs(valueUsd) > 1e-10).map(([securityId, valueUsd]) => ({ securityId, valueUsd }));
  if (positions.length > MAX_PORTFOLIO_ITEMS) throw new PortfolioCloneRequestError(`The cloned allocation exceeds ${MAX_PORTFOLIO_ITEMS} positions.`);
  const cashAmount = (draft.amount * rateToUsd - positions.reduce((sum, position) => sum + position.valueUsd, 0)) / rateToUsd;
  return { positions, cashAmount: Math.abs(cashAmount) < 1e-8 ? 0 : cashAmount, sources: summaries };
}
