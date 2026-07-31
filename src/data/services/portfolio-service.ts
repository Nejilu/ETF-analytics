import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import {
  findEtfById,
  findEtfByTicker,
  findSecuritiesByIds,
} from "@/db/repositories/catalog-repository";
import {
  loadDefaultPortfolio,
  replaceDefaultPortfolioItems,
  saveDefaultPortfolioAsEtf,
  type StoredPortfolio,
} from "@/db/repositories/portfolio-repository";
import type { EtfShareClass } from "@/domain/etf";
import type {
  PortfolioAnalysis,
  PortfolioAssetKind,
  PortfolioItem,
  PortfolioRecord,
} from "@/domain/portfolio";
import { analyzePortfolio } from "@/domain/processors/analyze-portfolio";

import { HoldingsUnavailableError, getHoldingsSnapshot } from "./holdings-service";

interface PortfolioItemDraft {
  id: string;
  kind: PortfolioAssetKind;
  referenceId: string;
  allocationWeight: number;
}

const MAX_PORTFOLIO_ITEMS = 50;

function validateDrafts(drafts: PortfolioItemDraft[]) {
  if (drafts.length > MAX_PORTFOLIO_ITEMS) {
    throw new Error(`A portfolio can contain up to ${MAX_PORTFOLIO_ITEMS} lines.`);
  }

  const seen = new Set<string>();
  let total = 0;
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
    if (
      !Number.isFinite(draft.allocationWeight) ||
      draft.allocationWeight <= 0 ||
      draft.allocationWeight > 100
    ) {
      throw new Error("Every allocation must be between 0% and 100%.");
    }
    const key = `${draft.kind}:${draft.referenceId}`;
    if (seen.has(key)) {
      throw new Error("Duplicate portfolio lines are not allowed.");
    }
    seen.add(key);
    total += draft.allocationWeight;
  }

  if (total > 100.000001) {
    throw new Error("Portfolio allocations cannot exceed 100%.");
  }
}

function resolveDrafts(drafts: PortfolioItemDraft[]): PortfolioItem[] {
  const securityIds = drafts
    .filter((draft) => draft.kind === "security")
    .map((draft) => draft.referenceId);
  const directSecurities = findSecuritiesByIds(securityIds);

  return drafts.map((draft) => {
    if (draft.kind === "etf") {
      const etf = findEtfById(draft.referenceId);
      if (!etf) {
        throw new Error("One of the selected ETFs is no longer available.");
      }
      return {
        ...draft,
        ticker: etf.ticker,
        name: etf.name,
      };
    }

    const security = directSecurities.get(draft.referenceId);
    if (!security) {
      throw new Error("One of the selected ACWI securities is no longer available.");
    }
    return {
      ...draft,
      ticker: security.ticker,
      name: security.name,
    };
  });
}

async function buildAnalysis(
  items: PortfolioItem[],
): Promise<PortfolioAnalysis | null> {
  if (items.length === 0) return null;

  const etfItems = items.filter((item) => item.kind === "etf");
  const snapshots = await Promise.all(
    etfItems.map((item) => getHoldingsSnapshot(item.ticker)),
  );
  const securityIds = items
    .filter((item) => item.kind === "security")
    .map((item) => item.referenceId);
  const directSecurities = findSecuritiesByIds(securityIds);

  return analyzePortfolio({
    items,
    etfSnapshots: new Map(
      snapshots.map((snapshot) => [snapshot.etf.ticker, snapshot]),
    ),
    directSecurities,
  });
}

async function recordWithAnalysis(
  stored: StoredPortfolio,
): Promise<PortfolioRecord> {
  try {
    return {
      ...stored,
      analysis: await buildAnalysis(stored.items),
    };
  } catch (error) {
    const analysisError =
      error instanceof HoldingsUnavailableError
        ? `${error.message} The saved portfolio is unchanged.`
        : error instanceof Error
          ? error.message
          : "The saved portfolio could not be analysed.";
    return { ...stored, analysis: null, analysisError };
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
  const items = resolveDrafts(drafts);
  replaceDefaultPortfolioItems(items);
  return recordWithAnalysis(loadDefaultPortfolio());
}

interface SavePortfolioEtfDraft {
  ticker: string;
  name: string;
  description?: string;
}

export function savePortfolioAsEtf(
  draft: SavePortfolioEtfDraft,
): EtfShareClass {
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

  const portfolio = loadDefaultPortfolio();
  if (portfolio.items.length === 0) {
    throw new Error("Add portfolio positions before saving it as an ETF.");
  }
  const total = portfolio.items.reduce(
    (sum, item) => sum + item.allocationWeight,
    0,
  );
  if (Math.abs(total - 100) > 0.000001) {
    throw new Error(
      `Allocate exactly 100% before saving an ETF. Current total: ${total.toFixed(2)}%.`,
    );
  }

  for (const item of portfolio.items) {
    if (item.kind !== "etf") continue;
    const component = findEtfById(item.referenceId);
    if (!component || component.fundType === "portfolio") {
      throw new Error(
        "Saved portfolio ETFs cannot contain another synthetic portfolio ETF.",
      );
    }
  }

  const components = portfolio.items
    .map(
      (item) =>
        `${item.allocationWeight.toFixed(2)}% ${item.ticker} ${
          item.kind === "etf" ? "ETF sleeve" : "direct stock"
        }`,
    )
    .join(", ");
  const description = [
    customDescription,
    `Components: ${components}.`,
    "Security-level holdings are recalculated from the latest persisted ETF compositions whenever this portfolio ETF is used.",
  ]
    .filter(Boolean)
    .join(" ");

  return saveDefaultPortfolioAsEtf({ ticker, name, description });
}
