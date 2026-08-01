import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  DERIVED_METRIC_KEYS,
  METRIC_DEFINITIONS,
  type MetricKey,
  type SecurityEstimateSeries,
  type SecurityMetricValues,
} from "@/domain/metrics";

import { getDb } from "../client";
import {
  metricDefinitions,
  metricObservations,
  securityProviderSymbols,
} from "../schema";

const QUERY_BATCH_SIZE = 250;
const ESTIMATE_SERIES_DEFINITION_ID = "security:eps_estimate_series:v1";
const ESTIMATE_SERIES_KEY = "eps_estimate_series";
const RETIRED_EPS_DEFINITION_IDS = [
  "pe_ttm",
  "pe_normalized_ttm",
  "pe_forward_fy",
  "pe_forward_consensus_6m_annualized",
  "pe_last_quarter_annualized",
  "pe_last_quarter_adjusted_annualized",
  "pe_next_quarter_annualized",
  "eps_growth_forward_fy",
  "eps_growth_forward_consensus_6m",
  "eps_growth_ttm_yoy",
  "close",
  "eps_diluted_ttm",
  "eps_diluted_fy",
  "eps_diluted_fq",
  "eps_headline_fy",
  "eps_headline_fq",
  "eps_forecast_next_fy",
  "eps_forecast_next_fq",
  "eps_forecast_next_fh",
  "operating_income_fq",
  "operating_income_fy",
  "operating_income_ttm",
  "net_income_fq",
  "net_income_fy",
  "net_income_ttm",
  "diluted_shares_fq",
  "unusual_income_expense_fq",
  "eps_adjusted_fq",
  "eps_adjusted_ttm",
  "net_to_operating_income_fq",
].map((key) => `security:${key}:v1`);

function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += QUERY_BATCH_SIZE) {
    result.push(items.slice(index, index + QUERY_BATCH_SIZE));
  }
  return result;
}

export interface ProviderSymbolRecord {
  securityId: string;
  providerSymbol: string | null;
  status: string;
  lastVerifiedAt: string;
}

export interface CachedSecurityMetrics extends SecurityMetricValues {
  capturedAt: string;
  observedKeys: Set<MetricKey>;
}

export interface CachedEstimateSeries {
  series: SecurityEstimateSeries;
  capturedAt: string;
}

export function ensureMetricDefinitions(): void {
  const db = getDb();
  db.delete(metricObservations)
    .where(inArray(metricObservations.metricDefinitionId, RETIRED_EPS_DEFINITION_IDS))
    .run();
  db.delete(metricDefinitions)
    .where(inArray(metricDefinitions.id, RETIRED_EPS_DEFINITION_IDS))
    .run();
  for (const definition of METRIC_DEFINITIONS) {
    db.insert(metricDefinitions)
      .values({
        id: `security:${definition.key}:v1`,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        entityType: "security",
        valueType: "number",
        unit: definition.unit,
        frequency: "daily",
        version: 1,
        formulaJson: {
          provider: "tradingview",
          column: definition.tradingViewColumn,
          formula: definition.formula ?? null,
          aggregation: definition.aggregate
            ? `${definition.aggregation ?? "weighted_mean"}-renormalized-to-covered-weight`
            : "component-only",
          validRange: definition.validRange ?? null,
        },
      })
      .onConflictDoUpdate({
        target: metricDefinitions.id,
        set: {
          name: definition.name,
          description: definition.description,
          unit: definition.unit,
          formulaJson: sql`excluded.formula_json`,
        },
      })
      .run();
  }
  db.insert(metricDefinitions)
    .values({
      id: ESTIMATE_SERIES_DEFINITION_ID,
      key: ESTIMATE_SERIES_KEY,
      name: "Quarterly EPS consensus estimate series",
      description: "Four historical event-consensus EPS observations and four current forward quarterly consensus observations; reported EPS is excluded.",
      entityType: "security",
      valueType: "json",
      unit: "currency_per_share",
      frequency: "daily",
      version: 1,
      formulaJson: {
        provider: "tradingview",
        quoteField: "eps_estimates_fq_h",
        priceField: "lp",
        actualFieldUsed: false,
      },
    })
    .onConflictDoUpdate({
      target: metricDefinitions.id,
      set: {
        description: "Four historical event-consensus EPS observations and four current forward quarterly consensus observations; reported EPS is excluded.",
        formulaJson: sql`excluded.formula_json`,
      },
    })
    .run();
}

function isEstimateSeries(value: unknown): value is SecurityEstimateSeries {
  if (!value || typeof value !== "object") return false;
  const series = value as Partial<SecurityEstimateSeries>;
  return typeof series.providerSymbol === "string" &&
    typeof series.currency === "string" &&
    typeof series.price === "number" &&
    Array.isArray(series.points) &&
    series.points.length === 8;
}

export function loadLatestEstimateSeries(securityIds: string[]): Map<string, CachedEstimateSeries> {
  if (securityIds.length === 0) return new Map();
  const rows = batches(securityIds).flatMap((batch) => getDb()
    .select({
      securityId: metricObservations.entityId,
      value: metricObservations.valueJson,
      capturedAt: metricObservations.capturedAt,
    })
    .from(metricObservations)
    .where(and(
      eq(metricObservations.metricDefinitionId, ESTIMATE_SERIES_DEFINITION_ID),
      inArray(metricObservations.entityId, batch),
    ))
    .orderBy(desc(metricObservations.capturedAt))
    .all());
  const output = new Map<string, CachedEstimateSeries>();
  for (const row of rows) {
    if (!output.has(row.securityId) && isEstimateSeries(row.value)) {
      output.set(row.securityId, { series: row.value, capturedAt: row.capturedAt });
    }
  }
  return output;
}

export function saveEstimateSeries(
  securityId: string,
  series: SecurityEstimateSeries,
  capturedAt: string,
): void {
  getDb().insert(metricObservations)
    .values({
      id: randomUUID(),
      metricDefinitionId: ESTIMATE_SERIES_DEFINITION_ID,
      entityType: "security",
      entityId: securityId,
      asOf: capturedAt.slice(0, 10),
      valueText: series.providerSymbol,
      valueJson: series,
      source: "tradingview-quote-estimates",
      capturedAt,
    })
    .onConflictDoUpdate({
      target: [
        metricObservations.metricDefinitionId,
        metricObservations.entityType,
        metricObservations.entityId,
        metricObservations.asOf,
      ],
      set: {
        valueText: series.providerSymbol,
        valueJson: series,
        source: "tradingview-quote-estimates",
        capturedAt,
      },
    })
    .run();
}

export function loadProviderSymbols(securityIds: string[]): Map<string, ProviderSymbolRecord> {
  const records = securityIds.length === 0
    ? []
    : batches(securityIds).flatMap((batch) => getDb()
        .select({
          securityId: securityProviderSymbols.securityId,
          providerSymbol: securityProviderSymbols.providerSymbol,
          status: securityProviderSymbols.status,
          lastVerifiedAt: securityProviderSymbols.lastVerifiedAt,
        })
        .from(securityProviderSymbols)
        .where(and(
          eq(securityProviderSymbols.provider, "tradingview"),
          inArray(securityProviderSymbols.securityId, batch),
        ))
        .all());
  return new Map(records.map((record) => [record.securityId, record]));
}

export function saveProviderSymbol(input: {
  securityId: string;
  providerSymbol: string | null;
  status: "resolved" | "unresolved";
  confidence: number | null;
  metadata?: Record<string, unknown>;
  verifiedAt: string;
}): void {
  getDb().insert(securityProviderSymbols)
    .values({
      provider: "tradingview",
      securityId: input.securityId,
      providerSymbol: input.providerSymbol,
      status: input.status,
      confidence: input.confidence,
      lastVerifiedAt: input.verifiedAt,
      metadataJson: input.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: [securityProviderSymbols.provider, securityProviderSymbols.securityId],
      set: {
        providerSymbol: input.providerSymbol,
        status: input.status,
        confidence: input.confidence,
        lastVerifiedAt: input.verifiedAt,
        metadataJson: input.metadata ?? null,
      },
    })
    .run();
}

export function loadLatestSecurityMetrics(securityIds: string[]): Map<string, CachedSecurityMetrics> {
  if (securityIds.length === 0) return new Map();
  const metricKeys = METRIC_DEFINITIONS.map((definition) => definition.key);
  const rows = batches(securityIds).flatMap((batch) => getDb()
    .select({
      securityId: metricObservations.entityId,
      key: metricDefinitions.key,
      value: metricObservations.valueNumber,
      providerSymbol: metricObservations.valueText,
      capturedAt: metricObservations.capturedAt,
    })
    .from(metricObservations)
    .innerJoin(
      metricDefinitions,
      eq(metricObservations.metricDefinitionId, metricDefinitions.id),
    )
    .where(and(
      eq(metricObservations.entityType, "security"),
      inArray(metricObservations.entityId, batch),
      inArray(metricDefinitions.key, metricKeys),
    ))
    .orderBy(desc(metricObservations.capturedAt))
    .all());

  const result = new Map<string, CachedSecurityMetrics>();
  for (const row of rows) {
    const key = row.key as MetricKey;
    const existing = result.get(row.securityId) ?? {
      securityId: row.securityId,
      providerSymbol: row.providerSymbol ?? "",
      values: {},
      capturedAt: row.capturedAt,
      observedKeys: new Set<MetricKey>(),
    };
    if (existing.observedKeys.has(key)) continue;
    existing.observedKeys.add(key);
    if (typeof row.value === "number") existing.values[key] = row.value;
    if (row.capturedAt > existing.capturedAt) existing.capturedAt = row.capturedAt;
    if (!existing.providerSymbol && row.providerSymbol) existing.providerSymbol = row.providerSymbol;
    result.set(row.securityId, existing);
  }
  return result;
}

export function saveSecurityMetrics(
  securityId: string,
  providerSymbol: string,
  values: Partial<Record<MetricKey, number>>,
  capturedAt: string,
): void {
  const asOf = capturedAt.slice(0, 10);
  const db = getDb();
  db.transaction((transaction) => {
    for (const definition of METRIC_DEFINITIONS) {
      transaction.insert(metricObservations)
        .values({
          id: randomUUID(),
          metricDefinitionId: `security:${definition.key}:v1`,
          entityType: "security",
          entityId: securityId,
          asOf,
          valueNumber: values[definition.key] ?? null,
          valueText: providerSymbol,
          source: "tradingview-screener",
          capturedAt,
        })
        .onConflictDoUpdate({
          target: [
            metricObservations.metricDefinitionId,
            metricObservations.entityType,
            metricObservations.entityId,
            metricObservations.asOf,
          ],
          set: {
            valueNumber: values[definition.key] ?? null,
            valueText: providerSymbol,
            source: "tradingview-screener",
            capturedAt,
          },
        })
        .run();
    }
  });
}

export function saveDerivedSecurityMetrics(
  securityId: string,
  providerSymbol: string,
  values: Partial<Record<MetricKey, number>>,
  capturedAt: string,
): void {
  const asOf = capturedAt.slice(0, 10);
  const db = getDb();
  db.transaction((transaction) => {
    for (const key of DERIVED_METRIC_KEYS) {
      transaction.insert(metricObservations)
        .values({
          id: randomUUID(),
          metricDefinitionId: `security:${key}:v1`,
          entityType: "security",
          entityId: securityId,
          asOf,
          valueNumber: values[key] ?? null,
          valueText: providerSymbol,
          source: "tradingview-estimates-derived-v1",
          capturedAt,
        })
        .onConflictDoUpdate({
          target: [
            metricObservations.metricDefinitionId,
            metricObservations.entityType,
            metricObservations.entityId,
            metricObservations.asOf,
          ],
          set: {
            valueNumber: values[key] ?? null,
            valueText: providerSymbol,
            source: "tradingview-estimates-derived-v1",
            capturedAt,
          },
        })
        .run();
    }
  });
}
