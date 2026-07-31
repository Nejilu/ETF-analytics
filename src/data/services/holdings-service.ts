import "server-only";

import { createHash } from "node:crypto";

import { parseIsharesHoldingsCsv } from "@/data/providers/ishares-csv";
import { fetchIsharesHoldingsFile } from "@/data/providers/ishares-source";
import {
  findLatestSnapshot,
  loadSnapshot,
  persistSnapshot,
} from "@/db/repositories/holdings-repository";
import { ensureLocalDatabase } from "@/db/bootstrap";
import {
  findEtfById,
  findEtfByTicker,
  findSecuritiesByIds,
} from "@/db/repositories/catalog-repository";
import { loadPortfolioById } from "@/db/repositories/portfolio-repository";
import type { HoldingsSnapshot } from "@/domain/etf";
import { analyzePortfolio } from "@/domain/processors/analyze-portfolio";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const inFlightRefreshes = new Map<
  string,
  Promise<HoldingsSnapshot>
>();

function cacheTtlSeconds() {
  const configured = Number(process.env.HOLDINGS_CACHE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_SECONDS;
}

function isFresh(fetchedAt: string, ttlSeconds: number): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  return (
    Number.isFinite(fetchedAtMs) &&
    Date.now() - fetchedAtMs < ttlSeconds * 1000
  );
}

export class HoldingsUnavailableError extends Error {
  readonly ticker: string;

  constructor(ticker: string, cause?: unknown) {
    super(
      cause instanceof Error
        ? `Holdings for ${ticker} are unavailable: ${cause.message}`
        : `Holdings for ${ticker} are unavailable.`,
    );
    this.name = "HoldingsUnavailableError";
    this.ticker = ticker;
  }
}

async function buildPortfolioEtfSnapshot(
  etf: NonNullable<ReturnType<typeof findEtfByTicker>>,
): Promise<HoldingsSnapshot> {
  if (!etf.portfolioId) {
    throw new Error(`Portfolio definition for ${etf.ticker} is missing.`);
  }
  const portfolio = loadPortfolioById(etf.portfolioId);
  if (!portfolio || portfolio.items.length === 0) {
    throw new Error(`Portfolio definition for ${etf.ticker} is empty.`);
  }

  const etfItems = portfolio.items.filter((item) => item.kind === "etf");
  for (const item of etfItems) {
    const component = findEtfById(item.referenceId);
    if (!component || component.fundType === "portfolio") {
      throw new Error(
        `${etf.ticker} contains an unsupported synthetic ETF component.`,
      );
    }
  }

  const snapshots = await Promise.all(
    etfItems.map((item) => getHoldingsSnapshot(item.ticker)),
  );
  const directSecurities = findSecuritiesByIds(
    portfolio.items
      .filter((item) => item.kind === "security")
      .map((item) => item.referenceId),
  );
  const analysis = analyzePortfolio({
    items: portfolio.items,
    etfSnapshots: new Map(
      snapshots.map((snapshot) => [snapshot.etf.ticker, snapshot]),
    ),
    directSecurities,
  });
  const sourceStatus =
    snapshots.some((snapshot) => snapshot.sourceStatus === "stale")
      ? "stale"
      : snapshots.some((snapshot) => snapshot.sourceStatus === "live")
        ? "live"
        : "cached";
  const asOf =
    snapshots
      .map((snapshot) => snapshot.asOf)
      .sort((left, right) => left.localeCompare(right))[0] ??
    new Date().toISOString().slice(0, 10);

  return {
    etf,
    asOf,
    fetchedAt: new Date().toISOString(),
    sourceStatus,
    sourceUrl: etf.holdingsUrl,
    cacheTtlHours: cacheTtlSeconds() / 3600,
    holdings: analysis.positions.map((position) => ({
      securityId: position.securityId,
      ticker: position.ticker,
      name: position.name,
      sector: position.sector,
      assetClass: position.assetClass,
      country: position.country,
      weight: position.weight,
    })),
  };
}

async function refreshHoldings(
  ticker: string,
): Promise<HoldingsSnapshot> {
  ensureLocalDatabase();

  const etf = findEtfByTicker(ticker);
  if (!etf) {
    throw new Error(`Unsupported ETF: ${ticker}`);
  }
  if (etf.fundType === "portfolio") {
    return buildPortfolioEtfSnapshot(etf);
  }

  const ttlSeconds = cacheTtlSeconds();
  const ttlHours = ttlSeconds / 3600;
  const latest = findLatestSnapshot(etf.id);

  if (latest && isFresh(latest.fetchedAt, ttlSeconds)) {
    return loadSnapshot(etf, latest, "cached", ttlHours);
  }

  try {
    const { raw, sourceUrl } = await fetchIsharesHoldingsFile(etf, ttlSeconds);
    const parsed = parseIsharesHoldingsCsv(raw);
    const fetchedAt = new Date().toISOString();
    const stored = persistSnapshot({
      etf,
      asOf: parsed.asOf,
      fetchedAt,
      sourceUrl,
      sourceHash: createHash("sha256").update(raw).digest("hex"),
      holdings: parsed.holdings,
    });

    return loadSnapshot(etf, stored, "live", ttlHours);
  } catch (error) {
    if (latest) {
      return loadSnapshot(etf, latest, "stale", ttlHours);
    }
    throw new HoldingsUnavailableError(etf.ticker, error);
  }
}

export async function getHoldingsSnapshot(
  ticker: string,
): Promise<HoldingsSnapshot> {
  const normalizedTicker = ticker.toUpperCase();
  const existing = inFlightRefreshes.get(normalizedTicker);
  if (existing) return existing;

  const refresh = refreshHoldings(normalizedTicker).finally(() => {
    inFlightRefreshes.delete(normalizedTicker);
  });
  inFlightRefreshes.set(normalizedTicker, refresh);
  return refresh;
}
