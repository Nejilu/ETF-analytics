import { sql } from "drizzle-orm";

import { ETF_CATALOG } from "../data/catalog";
import { getDb } from "./client";
import { benchmarks, etfs } from "./schema";

export function seedCatalog(): void {
  const db = getDb();

  db.transaction((transaction) => {
    for (const benchmark of ETF_CATALOG) {
      transaction
        .insert(benchmarks)
        .values({
          id: benchmark.id,
          name: benchmark.name,
          provider: benchmark.provider,
          region: benchmark.region,
          description: benchmark.description,
        })
        .onConflictDoUpdate({
          target: benchmarks.id,
          set: {
            name: benchmark.name,
            provider: benchmark.provider,
            region: benchmark.region,
            description: benchmark.description,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .run();

      for (const etf of benchmark.variants) {
        transaction
          .insert(etfs)
          .values({
            id: etf.id,
            ticker: etf.ticker,
            isin: etf.isin,
            name: etf.name,
            issuer: "iShares",
            benchmarkId: etf.benchmarkId,
            wrapper: etf.wrapper,
            domicile: etf.domicile,
            exchange: etf.exchange,
            tradingCurrency: etf.tradingCurrency,
            distributionPolicy: etf.distributionPolicy,
            ter: etf.ter,
            productUrl: etf.productUrl,
            holdingsUrl: etf.holdingsUrl,
            fundType: "physical",
            portfolioId: null,
            description: null,
            active: true,
          })
          .onConflictDoUpdate({
            target: etfs.id,
            set: {
              ticker: etf.ticker,
              isin: etf.isin,
              name: etf.name,
              issuer: "iShares",
              benchmarkId: etf.benchmarkId,
              wrapper: etf.wrapper,
              domicile: etf.domicile,
              exchange: etf.exchange,
              tradingCurrency: etf.tradingCurrency,
              distributionPolicy: etf.distributionPolicy,
              ter: etf.ter,
              productUrl: etf.productUrl,
              holdingsUrl: etf.holdingsUrl,
              fundType: "physical",
              portfolioId: null,
              active: true,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            },
          })
          .run();
      }
    }
  });
}
