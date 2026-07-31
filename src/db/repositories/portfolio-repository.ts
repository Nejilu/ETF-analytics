import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";

import type { EtfShareClass } from "@/domain/etf";
import type { PortfolioItem } from "@/domain/portfolio";

import { getDb } from "../client";
import {
  benchmarks,
  etfs,
  portfolioItems,
  portfolios,
  securities,
} from "../schema";

export const DEFAULT_PORTFOLIO_ID = "default-portfolio";

export interface StoredPortfolio {
  id: string;
  name: string;
  baseCurrency: string;
  updatedAt: string;
  items: PortfolioItem[];
}

function loadPortfolio(id: string): StoredPortfolio | undefined {
  const db = getDb();
  const portfolio = db
    .select()
    .from(portfolios)
    .where(eq(portfolios.id, id))
    .get();

  if (!portfolio) return undefined;

  const rows = db
    .select({
      id: portfolioItems.id,
      assetType: portfolioItems.assetType,
      allocationWeight: portfolioItems.allocationWeight,
      etfId: portfolioItems.etfId,
      etfTicker: etfs.ticker,
      etfName: etfs.name,
      securityId: portfolioItems.securityId,
      securityTicker: securities.primaryTicker,
      securityName: securities.name,
    })
    .from(portfolioItems)
    .leftJoin(etfs, eq(portfolioItems.etfId, etfs.id))
    .leftJoin(securities, eq(portfolioItems.securityId, securities.id))
    .where(eq(portfolioItems.portfolioId, id))
    .orderBy(asc(portfolioItems.createdAt))
    .all();

  return {
    id: portfolio.id,
    name: portfolio.name,
    baseCurrency: portfolio.baseCurrency,
    updatedAt: portfolio.updatedAt,
    items: rows.map((row) => {
      const kind = row.assetType === "security" ? "security" : "etf";
      return {
        id: row.id,
        kind,
        referenceId:
          kind === "security" ? row.securityId ?? "" : row.etfId ?? "",
        ticker:
          kind === "security"
            ? row.securityTicker ?? "—"
            : row.etfTicker ?? "—",
        name:
          kind === "security"
            ? row.securityName ?? "Unknown security"
            : row.etfName ?? "Unknown ETF",
        allocationWeight: row.allocationWeight,
      };
    }),
  };
}

export function loadDefaultPortfolio(): StoredPortfolio {
  const db = getDb();
  db.insert(portfolios)
    .values({
      id: DEFAULT_PORTFOLIO_ID,
      name: "My portfolio",
      baseCurrency: "USD",
    })
    .onConflictDoNothing()
    .run();

  const portfolio = loadPortfolio(DEFAULT_PORTFOLIO_ID);
  if (!portfolio) {
    throw new Error("Unable to initialise the portfolio.");
  }
  return portfolio;
}

export function loadPortfolioById(id: string): StoredPortfolio | undefined {
  return loadPortfolio(id);
}

export function replaceDefaultPortfolioItems(items: PortfolioItem[]) {
  const db = getDb();

  db.transaction((transaction) => {
    transaction
      .insert(portfolios)
      .values({
        id: DEFAULT_PORTFOLIO_ID,
        name: "My portfolio",
        baseCurrency: "USD",
      })
      .onConflictDoUpdate({
        target: portfolios.id,
        set: { updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .run();

    transaction
      .delete(portfolioItems)
      .where(eq(portfolioItems.portfolioId, DEFAULT_PORTFOLIO_ID))
      .run();

    if (items.length > 0) {
      transaction
        .insert(portfolioItems)
        .values(
          items.map((item) => ({
            id: item.id,
            portfolioId: DEFAULT_PORTFOLIO_ID,
            assetType: item.kind,
            etfId: item.kind === "etf" ? item.referenceId : null,
            securityId:
              item.kind === "security" ? item.referenceId : null,
            allocationWeight: item.allocationWeight,
          })),
        )
        .run();
    }
  });
}

interface SavePortfolioAsEtfInput {
  ticker: string;
  name: string;
  description: string;
}

export function saveDefaultPortfolioAsEtf(
  input: SavePortfolioAsEtfInput,
): EtfShareClass {
  const db = getDb();
  const source = loadDefaultPortfolio();
  const portfolioId = `saved-portfolio-${randomUUID()}`;
  const etfId = `portfolio-etf-${randomUUID()}`;
  const localIsin = `LOCAL-${randomUUID()}`;
  const now = new Date().toISOString();

  db.transaction((transaction) => {
    transaction
      .insert(benchmarks)
      .values({
        id: "saved-portfolios",
        name: "Saved portfolios",
        provider: "IndexLens",
        region: "Local workspace",
        description:
          "User-defined portfolios recalculated from their ETF sleeves and direct stocks.",
      })
      .onConflictDoNothing()
      .run();

    transaction
      .insert(portfolios)
      .values({
        id: portfolioId,
        name: input.name,
        baseCurrency: source.baseCurrency,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    transaction
      .insert(portfolioItems)
      .values(
        source.items.map((item) => ({
          id: randomUUID(),
          portfolioId,
          assetType: item.kind,
          etfId: item.kind === "etf" ? item.referenceId : null,
          securityId: item.kind === "security" ? item.referenceId : null,
          allocationWeight: item.allocationWeight,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .run();

    transaction
      .insert(etfs)
      .values({
        id: etfId,
        ticker: input.ticker,
        isin: localIsin,
        name: input.name,
        issuer: "IndexLens",
        benchmarkId: "saved-portfolios",
        wrapper: "SYNTHETIC",
        domicile: "Local workspace",
        exchange: "IndexLens",
        tradingCurrency: source.baseCurrency,
        distributionPolicy: "Look-through",
        ter: 0,
        productUrl: `/portfolio/${portfolioId}`,
        holdingsUrl: `local://portfolio/${portfolioId}`,
        fundType: "portfolio",
        portfolioId,
        description: input.description,
        active: true,
        metadataJson: {
          compositionModel: "relational-look-through",
          componentCount: source.items.length,
          recalculation: "on-read",
        },
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  return {
    id: etfId,
    ticker: input.ticker,
    name: input.name,
    benchmarkId: "saved-portfolios",
    isin: localIsin,
    wrapper: "SYNTHETIC",
    domicile: "Local workspace",
    exchange: "IndexLens",
    tradingCurrency: source.baseCurrency,
    distributionPolicy: "Look-through",
    ter: 0,
    productUrl: `/portfolio/${portfolioId}`,
    holdingsUrl: `local://portfolio/${portfolioId}`,
    fundType: "portfolio",
    portfolioId,
    description: input.description,
  };
}
