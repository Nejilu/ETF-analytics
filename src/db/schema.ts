import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const benchmarks = sqliteTable(
  "benchmarks",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    region: text("region"),
    methodologyUrl: text("methodology_url"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("benchmarks_name_provider_uq").on(table.name, table.provider)],
);

export const etfs = sqliteTable(
  "etfs",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    isin: text("isin").notNull(),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    benchmarkId: text("benchmark_id")
      .notNull()
      .references(() => benchmarks.id),
    wrapper: text("wrapper").notNull(),
    domicile: text("domicile").notNull(),
    exchange: text("exchange").notNull(),
    tradingCurrency: text("trading_currency").notNull(),
    distributionPolicy: text("distribution_policy").notNull(),
    ter: real("ter"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    metadataJson: text("metadata_json", { mode: "json" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("etfs_ticker_exchange_uq").on(table.ticker, table.exchange),
    uniqueIndex("etfs_isin_uq").on(table.isin),
    index("etfs_benchmark_idx").on(table.benchmarkId),
  ],
);

export const securities = sqliteTable(
  "securities",
  {
    id: text("id").primaryKey(),
    isin: text("isin"),
    primaryTicker: text("primary_ticker"),
    name: text("name").notNull(),
    assetClass: text("asset_class"),
    sector: text("sector"),
    industry: text("industry"),
    country: text("country"),
    currency: text("currency"),
    identifiersJson: text("identifiers_json", { mode: "json" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("securities_isin_uq").on(table.isin),
    index("securities_ticker_idx").on(table.primaryTicker),
  ],
);

export const holdingSnapshots = sqliteTable(
  "holding_snapshots",
  {
    id: text("id").primaryKey(),
    etfId: text("etf_id")
      .notNull()
      .references(() => etfs.id),
    asOf: text("as_of").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceHash: text("source_hash"),
    sourceStatus: text("source_status").notNull(),
    totalWeight: real("total_weight").notNull(),
    rowCount: integer("row_count").notNull(),
    rawMetadataJson: text("raw_metadata_json", { mode: "json" }),
  },
  (table) => [
    uniqueIndex("holding_snapshots_etf_asof_hash_uq").on(
      table.etfId,
      table.asOf,
      table.sourceHash,
    ),
    index("holding_snapshots_latest_idx").on(table.etfId, table.asOf),
  ],
);

export const holdings = sqliteTable(
  "holdings",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => holdingSnapshots.id),
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id),
    weight: real("weight").notNull(),
    quantity: real("quantity"),
    marketValue: real("market_value"),
    localPrice: real("local_price"),
    currency: text("currency"),
    sourceTicker: text("source_ticker"),
    sourceRowJson: text("source_row_json", { mode: "json" }),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.securityId] }),
    index("holdings_security_idx").on(table.securityId),
  ],
);

export const metricDefinitions = sqliteTable(
  "metric_definitions",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    entityType: text("entity_type").notNull(),
    valueType: text("value_type").notNull(),
    unit: text("unit"),
    frequency: text("frequency"),
    version: integer("version").notNull().default(1),
    formulaJson: text("formula_json", { mode: "json" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("metric_definitions_key_version_uq").on(table.key, table.version),
  ],
);

export const metricObservations = sqliteTable(
  "metric_observations",
  {
    id: text("id").primaryKey(),
    metricDefinitionId: text("metric_definition_id")
      .notNull()
      .references(() => metricDefinitions.id),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    asOf: text("as_of").notNull(),
    valueNumber: real("value_number"),
    valueText: text("value_text"),
    valueJson: text("value_json", { mode: "json" }),
    source: text("source"),
    capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("metric_observations_natural_uq").on(
      table.metricDefinitionId,
      table.entityType,
      table.entityId,
      table.asOf,
    ),
    index("metric_observations_entity_idx").on(table.entityType, table.entityId),
  ],
);
