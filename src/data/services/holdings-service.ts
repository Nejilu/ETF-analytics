import "server-only";

import { getEtfByTicker } from "@/data/catalog";
import { parseIsharesHoldingsCsv } from "@/data/providers/ishares-csv";
import type { HoldingsSnapshot } from "@/domain/etf";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

function cacheTtlSeconds() {
  const configured = Number(process.env.HOLDINGS_CACHE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_SECONDS;
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

export async function getHoldingsSnapshot(
  ticker: string,
): Promise<HoldingsSnapshot> {
  const etf = getEtfByTicker(ticker);
  if (!etf) {
    throw new Error(`Unsupported ETF: ${ticker}`);
  }

  try {
    const response = await fetch(etf.holdingsUrl, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "IndexLens/0.1 holdings-research",
      },
      next: {
        revalidate: cacheTtlSeconds(),
        tags: [`holdings:${etf.ticker}`],
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      throw new Error(`iShares source unavailable (${response.status}).`);
    }

    const parsed = parseIsharesHoldingsCsv(await response.text());
    return {
      etf,
      asOf: parsed.asOf,
      fetchedAt: new Date().toISOString(),
      sourceStatus: "live",
      sourceUrl: etf.holdingsUrl,
      cacheTtlHours: cacheTtlSeconds() / 3600,
      holdings: parsed.holdings,
    };
  } catch (error) {
    throw new HoldingsUnavailableError(etf.ticker, error);
  }
}
