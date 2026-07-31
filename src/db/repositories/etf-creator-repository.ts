import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { EtfCreatorCriteria } from "@/domain/etf-creator";
import type { EtfShareClass, Holding, HoldingsSnapshot } from "@/domain/etf";

import { getDb } from "../client";
import {
  benchmarks,
  etfs,
  holdings,
  holdingSnapshots,
  securities,
} from "../schema";

const INSERT_BATCH_SIZE = 75;

interface SaveCreatedEtfInput {
  ticker: string;
  name: string;
  description: string;
  source: HoldingsSnapshot;
  selectedHoldings: Holding[];
  criteria: EtfCreatorCriteria;
}

function batches<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
    result.push(rows.slice(index, index + INSERT_BATCH_SIZE));
  }
  return result;
}

export function saveCreatedEtf(input: SaveCreatedEtfInput): EtfShareClass {
  const db = getDb();
  const etfId = `custom-etf-${randomUUID()}`;
  const snapshotId = randomUUID();
  const localIsin = `LOCAL-${randomUUID()}`;
  const now = new Date().toISOString();
  const sourceHash = `frozen:${input.source.etf.id}:${input.source.asOf}:${snapshotId}`;

  db.transaction((transaction) => {
    transaction
      .insert(benchmarks)
      .values({
        id: "created-etfs",
        name: "Custom ACWI ETFs",
        provider: "IndexLens",
        region: "ACWI custom universe",
        description:
          "User-created, free-float-weighted selections frozen from an ACWI snapshot.",
      })
      .onConflictDoNothing()
      .run();

    transaction
      .insert(etfs)
      .values({
        id: etfId,
        ticker: input.ticker,
        isin: localIsin,
        name: input.name,
        issuer: "IndexLens",
        benchmarkId: "created-etfs",
        wrapper: "SYNTHETIC",
        domicile: "Local workspace",
        exchange: "IndexLens",
        tradingCurrency: "USD",
        distributionPolicy: "Look-through",
        ter: 0,
        productUrl: "/#etf-creator",
        holdingsUrl: `local://custom-etf/${etfId}`,
        priceSymbol: null,
        fundType: "custom",
        portfolioId: null,
        description: input.description,
        active: true,
        metadataJson: {
          compositionModel: "frozen-acwi-free-float",
          sourceEtfId: input.source.etf.id,
          sourceTicker: input.source.etf.ticker,
          sourceAsOf: input.source.asOf,
          sourceFetchedAt: input.source.fetchedAt,
          selectedCount: input.selectedHoldings.length,
          criteria: input.criteria,
          frozenAt: now,
        },
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const batch of batches(input.selectedHoldings)) {
      transaction
        .insert(securities)
        .values(
          batch.map((holding) => ({
            id: holding.securityId,
            isin: holding.isin,
            primaryTicker: holding.ticker === "—" ? null : holding.ticker,
            name: holding.name,
            assetClass: holding.assetClass,
            sector: holding.sector,
            country: holding.country,
            currency: holding.currency,
          })),
        )
        .onConflictDoUpdate({
          target: securities.id,
          set: {
            isin: sql`excluded.isin`,
            primaryTicker: sql`excluded.primary_ticker`,
            name: sql`excluded.name`,
            assetClass: sql`excluded.asset_class`,
            sector: sql`excluded.sector`,
            country: sql`excluded.country`,
            currency: sql`excluded.currency`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .run();
    }

    transaction
      .insert(holdingSnapshots)
      .values({
        id: snapshotId,
        etfId,
        asOf: input.source.asOf,
        fetchedAt: now,
        sourceUrl: input.source.sourceUrl,
        sourceHash,
        sourceStatus: "cached",
        totalWeight: input.selectedHoldings.reduce(
          (sum, holding) => sum + holding.weight,
          0,
        ),
        rowCount: input.selectedHoldings.length,
        rawMetadataJson: {
          frozen: true,
          sourceEtfId: input.source.etf.id,
          sourceAsOf: input.source.asOf,
        },
      })
      .run();

    for (const batch of batches(input.selectedHoldings)) {
      transaction
        .insert(holdings)
        .values(
          batch.map((holding) => ({
            snapshotId,
            securityId: holding.securityId,
            weight: holding.weight,
            marketValue: null,
            currency: holding.currency,
            sourceTicker: holding.ticker === "—" ? null : holding.ticker,
            sourceRowJson: {
              sourceEtfId: input.source.etf.id,
              sourceAsOf: input.source.asOf,
              frozen: true,
            },
          })),
        )
        .run();
    }
  });

  return {
    id: etfId,
    ticker: input.ticker,
    name: input.name,
    benchmarkId: "created-etfs",
    isin: localIsin,
    wrapper: "SYNTHETIC",
    domicile: "Local workspace",
    exchange: "IndexLens",
    tradingCurrency: "USD",
    distributionPolicy: "Look-through",
    ter: 0,
    productUrl: "/#etf-creator",
    holdingsUrl: `local://custom-etf/${etfId}`,
    issuer: "IndexLens",
    fundType: "custom",
    description: input.description,
  };
}
