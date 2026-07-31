import { and, asc, eq, inArray } from "drizzle-orm";

import type { CatalogGroup, EtfShareClass } from "@/domain/etf";
import type { PortfolioSecurity } from "@/domain/portfolio";

import { getDb } from "../client";
import { benchmarks, etfs, securities } from "../schema";

function mapEtfRow(row: typeof etfs.$inferSelect): EtfShareClass {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    benchmarkId: row.benchmarkId,
    isin: row.isin,
    wrapper: row.wrapper as EtfShareClass["wrapper"],
    domicile: row.domicile,
    exchange: row.exchange,
    tradingCurrency: row.tradingCurrency,
    distributionPolicy:
      row.distributionPolicy as EtfShareClass["distributionPolicy"],
    ter: row.ter ?? 0,
    productUrl: row.productUrl,
    holdingsUrl: row.holdingsUrl,
    fundType:
      row.fundType === "portfolio" ? "portfolio" : "physical",
    portfolioId: row.portfolioId ?? undefined,
    description: row.description ?? undefined,
  };
}

export function listCatalogGroups(): CatalogGroup[] {
  const db = getDb();
  const benchmarkRows = db
    .select()
    .from(benchmarks)
    .orderBy(asc(benchmarks.createdAt))
    .all();
  const etfRows = db
    .select()
    .from(etfs)
    .where(eq(etfs.active, true))
    .orderBy(asc(etfs.createdAt))
    .all();

  return benchmarkRows
    .map((benchmark) => ({
      id: benchmark.id,
      name: benchmark.name,
      provider: benchmark.provider,
      region: benchmark.region ?? "",
      description: benchmark.description ?? "",
      variants: etfRows
        .filter((etf) => etf.benchmarkId === benchmark.id)
        .map(mapEtfRow),
    }))
    .filter((benchmark) => benchmark.variants.length > 0);
}

export function findEtfByTicker(
  ticker: string,
): EtfShareClass | undefined {
  const row = getDb()
    .select()
    .from(etfs)
    .where(
      and(
        eq(etfs.ticker, ticker.toUpperCase()),
        eq(etfs.active, true),
      ),
    )
    .limit(1)
    .get();

  if (!row) return undefined;

  return mapEtfRow(row);
}

export function findEtfById(id: string): EtfShareClass | undefined {
  const row = getDb()
    .select()
    .from(etfs)
    .where(and(eq(etfs.id, id), eq(etfs.active, true)))
    .limit(1)
    .get();

  return row ? mapEtfRow(row) : undefined;
}

export function findSecuritiesByIds(
  ids: string[],
): Map<string, PortfolioSecurity> {
  if (ids.length === 0) return new Map();

  const rows = getDb()
    .select()
    .from(securities)
    .where(inArray(securities.id, ids))
    .all();

  return new Map(
    rows.map((row) => [
      row.id,
      {
        securityId: row.id,
        ticker: row.primaryTicker ?? "—",
        name: row.name,
        sector: row.sector ?? "Unclassified",
        assetClass: row.assetClass ?? "Unclassified",
        country: row.country ?? "Not reported",
      },
    ]),
  );
}
