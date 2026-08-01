import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type {
  DataStatus,
  EtfShareClass,
  Holding,
  HoldingsSnapshot,
} from "@/domain/etf";

import { getDb } from "../client";
import {
  holdings,
  holdingSnapshots,
  securities,
} from "../schema";

type SnapshotRecord = typeof holdingSnapshots.$inferSelect;

function exchangeFromIdentifiers(value: unknown): string | undefined {
  const candidate = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return undefined;
        }
      })()
    : value;
  if (!candidate || typeof candidate !== "object") return undefined;
  const exchange = (candidate as Record<string, unknown>).exchange;
  return typeof exchange === "string" && exchange.trim() ? exchange : undefined;
}

const INSERT_BATCH_SIZE = 75;

function batches<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
    result.push(rows.slice(index, index + INSERT_BATCH_SIZE));
  }
  return result;
}

export function findLatestSnapshot(
  etfId: string,
): SnapshotRecord | undefined {
  return getDb()
    .select()
    .from(holdingSnapshots)
    .where(eq(holdingSnapshots.etfId, etfId))
    .orderBy(
      desc(holdingSnapshots.fetchedAt),
      desc(holdingSnapshots.asOf),
    )
    .limit(1)
    .get();
}

export function loadSnapshot(
  etf: EtfShareClass,
  snapshot: SnapshotRecord,
  sourceStatus: DataStatus,
  cacheTtlHours: number,
): HoldingsSnapshot {
  const rows = getDb()
    .select({
      securityId: securities.id,
      ticker: holdings.sourceTicker,
      primaryTicker: securities.primaryTicker,
      name: securities.name,
      sector: securities.sector,
      assetClass: securities.assetClass,
      country: securities.country,
      isin: securities.isin,
      weight: holdings.weight,
      marketValue: holdings.marketValue,
      currency: holdings.currency,
      securityCurrency: securities.currency,
      identifiersJson: securities.identifiersJson,
    })
    .from(holdings)
    .innerJoin(
      securities,
      eq(holdings.securityId, securities.id),
    )
    .where(eq(holdings.snapshotId, snapshot.id))
    .all();

  return {
    etf,
    asOf: snapshot.asOf,
    fetchedAt: snapshot.fetchedAt,
    sourceStatus,
    sourceUrl: snapshot.sourceUrl,
    cacheTtlHours,
    holdings: rows.map((row) => ({
      securityId: row.securityId,
      ticker: row.ticker ?? row.primaryTicker ?? "—",
      name: row.name,
      sector: row.sector ?? "Unclassified",
      assetClass: row.assetClass ?? "Unclassified",
      country: row.country ?? "Not reported",
      isin: row.isin ?? undefined,
      weight: row.weight,
      marketValue: row.marketValue ?? undefined,
      currency: row.currency ?? row.securityCurrency ?? undefined,
      exchange: exchangeFromIdentifiers(row.identifiersJson),
    })).sort((left, right) => right.weight - left.weight),
  };
}

interface PersistSnapshotInput {
  etf: EtfShareClass;
  asOf: string;
  fetchedAt: string;
  sourceUrl: string;
  sourceHash: string;
  holdings: Holding[];
}

export function persistSnapshot(
  input: PersistSnapshotInput,
): SnapshotRecord {
  const db = getDb();
  const totalWeight = input.holdings.reduce(
    (sum, holding) => sum + holding.weight,
    0,
  );

  return db.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(holdingSnapshots)
      .where(
        and(
          eq(holdingSnapshots.etfId, input.etf.id),
          eq(holdingSnapshots.asOf, input.asOf),
          eq(holdingSnapshots.sourceHash, input.sourceHash),
        ),
      )
      .limit(1)
      .get();

    if (existing) {
      transaction
        .update(holdingSnapshots)
        .set({
          fetchedAt: input.fetchedAt,
          sourceUrl: input.sourceUrl,
          sourceStatus: "live",
          totalWeight,
          rowCount: input.holdings.length,
        })
        .where(eq(holdingSnapshots.id, existing.id))
        .run();

      return {
        ...existing,
        fetchedAt: input.fetchedAt,
        sourceUrl: input.sourceUrl,
        sourceStatus: "live",
        totalWeight,
        rowCount: input.holdings.length,
      };
    }

    for (const batch of batches(input.holdings)) {
      transaction
        .insert(securities)
        .values(
          batch.map((holding) => ({
            id: holding.securityId,
            isin: holding.isin,
            primaryTicker:
              holding.ticker === "—" ? null : holding.ticker,
            name: holding.name,
            assetClass: holding.assetClass,
            sector: holding.sector,
            country: holding.country,
            currency: holding.currency,
            identifiersJson: holding.exchange
              ? { exchange: holding.exchange }
              : null,
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
            identifiersJson: sql`COALESCE(excluded.identifiers_json, ${securities.identifiersJson})`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .run();
    }

    const id = randomUUID();
    const record: SnapshotRecord = {
      id,
      etfId: input.etf.id,
      asOf: input.asOf,
      fetchedAt: input.fetchedAt,
      sourceUrl: input.sourceUrl,
      sourceHash: input.sourceHash,
      sourceStatus: "live",
      totalWeight,
      rowCount: input.holdings.length,
      rawMetadataJson: null,
    };

    transaction.insert(holdingSnapshots).values(record).run();

    for (const batch of batches(input.holdings)) {
      transaction
        .insert(holdings)
        .values(
          batch.map((holding) => ({
            snapshotId: id,
            securityId: holding.securityId,
            weight: holding.weight,
            marketValue: holding.marketValue,
            currency: holding.currency,
            sourceTicker:
              holding.ticker === "—" ? null : holding.ticker,
          })),
        )
        .run();
    }

    return record;
  });
}
