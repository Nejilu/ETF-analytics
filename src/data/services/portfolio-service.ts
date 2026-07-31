import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import {
  findEtfById,
  findEtfByTicker,
  findSecuritiesByIds,
} from "@/db/repositories/catalog-repository";
import {
  anchorPortfolioQuantities,
  loadDefaultPortfolio,
  replaceDefaultPortfolioItems,
  saveDefaultPortfolioAsEtf,
  type StoredPortfolio,
} from "@/db/repositories/portfolio-repository";
import type { EtfShareClass } from "@/domain/etf";
import type {
  PortfolioAnalysis,
  PortfolioAssetKind,
  PortfolioInputMode,
  PortfolioItem,
  PortfolioRecord,
} from "@/domain/portfolio";
import { analyzePortfolio } from "@/domain/processors/analyze-portfolio";
import { securityQuoteAlias } from "@/domain/security-equivalence";

import { HoldingsUnavailableError, getHoldingsSnapshot } from "./holdings-service";
import {
  getMarketPrices,
  valuePortfolioItems,
} from "./market-price-service";

interface PortfolioItemDraft {
  id: string;
  kind: PortfolioAssetKind;
  referenceId: string;
  inputMode: PortfolioInputMode;
  inputAmount: number;
}

const MAX_PORTFOLIO_ITEMS = 50;

function validateDrafts(drafts: PortfolioItemDraft[]) {
  if (drafts.length > MAX_PORTFOLIO_ITEMS) {
    throw new Error(`A portfolio can contain up to ${MAX_PORTFOLIO_ITEMS} lines.`);
  }

  const seen = new Set<string>();
  for (const draft of drafts) {
    if (!draft.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(draft.id)) {
      throw new Error("Every portfolio line must have a valid id.");
    }
    if (draft.kind !== "etf" && draft.kind !== "security") {
      throw new Error("Unsupported portfolio asset type.");
    }
    if (!draft.referenceId || draft.referenceId.length > 100) {
      throw new Error("Every portfolio line must reference an asset.");
    }
    if (draft.inputMode !== "value" && draft.inputMode !== "shares") {
      throw new Error("Every line must use value or shares as its input mode.");
    }
    if (!Number.isFinite(draft.inputAmount) || draft.inputAmount <= 0) {
      throw new Error("Every position amount must be greater than zero.");
    }
    const key = `${draft.kind}:${draft.referenceId}`;
    if (seen.has(key)) {
      throw new Error("Duplicate portfolio lines are not allowed.");
    }
    seen.add(key);
  }
}

async function resolveDrafts(
  drafts: PortfolioItemDraft[],
): Promise<PortfolioItem[]> {
  const securityIds = drafts
    .filter((draft) => draft.kind === "security")
    .map((draft) => draft.referenceId);
  const directSecurities = findSecuritiesByIds(securityIds);

  const resolved = drafts.map((draft): PortfolioItem => {
    if (draft.kind === "etf") {
      const etf = findEtfById(draft.referenceId);
      if (
        !etf ||
        etf.fundType === "portfolio" ||
        etf.fundType === "custom"
      ) {
        throw new Error("One of the selected ETFs is no longer available.");
      }
      return {
        ...draft,
        ticker: etf.ticker,
        name: etf.name,
        allocationWeight: 0,
      };
    }

    const security = directSecurities.get(draft.referenceId);
    if (!security) {
      throw new Error("One of the selected ACWI securities is no longer available.");
    }
    const alias = securityQuoteAlias(security);
    return {
      ...draft,
      ticker: alias?.displayTicker ?? security.ticker,
      name: security.name,
      allocationWeight: 0,
    };
  });
  const prices = await getMarketPrices(
    resolved.map((item) => ({
      kind: item.kind,
      referenceId: item.referenceId,
    })),
  );
  const withQuantities = resolved.map((item) => {
    const price = prices.get(`${item.kind}:${item.referenceId}`);
    if (!price) throw new Error(`Price for ${item.ticker} is unavailable.`);
    const inputAmount = Number(item.inputAmount);
    if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
      throw new Error(`A valid amount is required for ${item.ticker}.`);
    }
    const quantity =
      item.inputMode === "shares"
        ? inputAmount
        : inputAmount / price.priceUsd;
    return {
      ...item,
      quantity,
      initialPriceUsd: price.priceUsd,
      initialValueUsd: quantity * price.priceUsd,
      priceSymbol: price.providerSymbol,
      priceCurrency: price.currency,
    };
  });
  return (await valuePortfolioItems(withQuantities)).items;
}

async function buildAnalysis(
  items: PortfolioItem[],
): Promise<PortfolioAnalysis | null> {
  if (items.length === 0) return null;

  const etfItems = items.filter((item) => item.kind === "etf");
  const snapshots = await Promise.all(
    etfItems.map((item) => getHoldingsSnapshot(item.referenceId)),
  );
  const securityIds = items
    .filter((item) => item.kind === "security")
    .map((item) => item.referenceId);
  const directSecurities = findSecuritiesByIds(securityIds);

  return analyzePortfolio({
    items,
    etfSnapshots: new Map(
      snapshots.map((snapshot) => [snapshot.etf.id, snapshot]),
    ),
    directSecurities,
  });
}

async function recordWithAnalysis(
  stored: StoredPortfolio,
): Promise<PortfolioRecord> {
  let valued;
  try {
    valued = await valuePortfolioItems(stored.items);
    if (stored.items.some((item) => !item.quantity)) {
      anchorPortfolioQuantities(stored.id, valued.items);
    }
  } catch (error) {
    return {
      ...stored,
      analysis: null,
      priceError:
        error instanceof Error
          ? error.message
          : "Market prices are unavailable.",
    };
  }

  try {
    const analysis = await buildAnalysis(valued.items);
    return {
      ...stored,
      items: valued.items,
      analysis: analysis
        ? {
            ...analysis,
            totalMarketValueUsd: valued.totalMarketValueUsd,
          }
        : null,
    };
  } catch (error) {
    const analysisError =
      error instanceof HoldingsUnavailableError
        ? `${error.message} The saved portfolio is unchanged.`
        : error instanceof Error
          ? error.message
          : "The saved portfolio could not be analysed.";
    return {
      ...stored,
      items: valued.items,
      analysis: null,
      analysisError,
    };
  }
}

export async function getPortfolio(): Promise<PortfolioRecord> {
  ensureLocalDatabase();
  return recordWithAnalysis(loadDefaultPortfolio());
}

export async function savePortfolio(
  drafts: PortfolioItemDraft[],
): Promise<PortfolioRecord> {
  ensureLocalDatabase();
  validateDrafts(drafts);
  const items = await resolveDrafts(drafts);
  replaceDefaultPortfolioItems(items);
  return recordWithAnalysis(loadDefaultPortfolio());
}

interface SavePortfolioEtfDraft {
  ticker: string;
  name: string;
  description?: string;
}

export async function savePortfolioAsEtf(
  draft: SavePortfolioEtfDraft,
): Promise<EtfShareClass> {
  ensureLocalDatabase();
  const ticker = draft.ticker.trim().toUpperCase();
  const name = draft.name.trim();
  const customDescription = draft.description?.trim();

  if (!/^[A-Z][A-Z0-9.-]{1,9}$/.test(ticker)) {
    throw new Error(
      "Use a ticker of 2 to 10 letters, numbers, dots or hyphens.",
    );
  }
  if (name.length < 3 || name.length > 80) {
    throw new Error("The ETF name must contain between 3 and 80 characters.");
  }
  if (customDescription && customDescription.length > 240) {
    throw new Error("The description cannot exceed 240 characters.");
  }
  if (findEtfByTicker(ticker)) {
    throw new Error(`Ticker ${ticker} is already used.`);
  }

  const stored = loadDefaultPortfolio();
  const portfolio = {
    ...stored,
    ...(await valuePortfolioItems(stored.items)),
  };
  if (stored.items.some((item) => !item.quantity)) {
    anchorPortfolioQuantities(stored.id, portfolio.items);
  }
  if (portfolio.items.length === 0) {
    throw new Error("Add portfolio positions before saving it as an ETF.");
  }

  for (const item of portfolio.items) {
    if (!item.quantity || item.quantity <= 0) {
      throw new Error(`A valid share quantity is required for ${item.ticker}.`);
    }
    if (item.kind !== "etf") continue;
    const component = findEtfById(item.referenceId);
    if (
      !component ||
      component.fundType === "portfolio" ||
      component.fundType === "custom"
    ) {
      throw new Error(
        "Saved portfolio ETFs cannot contain another synthetic portfolio ETF.",
      );
    }
  }

  const components = portfolio.items
    .map(
      (item) =>
        `${item.quantity?.toFixed(6)} shares of ${item.ticker} ${
          item.kind === "etf" ? "ETF sleeve" : "direct stock"
        } (currently ${item.allocationWeight.toFixed(2)}%)`,
    )
    .join(", ");
  const description = [
    customDescription,
    `Components: ${components}.`,
    "Component weights are recalculated from current market prices, and security-level holdings use the latest persisted ETF compositions whenever this portfolio ETF is used.",
  ]
    .filter(Boolean)
    .join(" ");

  return saveDefaultPortfolioAsEtf({ ticker, name, description });
}
