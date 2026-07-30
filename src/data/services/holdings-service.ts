import "server-only";

import { getEtfByTicker } from "@/data/catalog";
import { parseIsharesHoldingsCsv } from "@/data/providers/ishares-csv";
import { getSeedSnapshot } from "@/data/seed-holdings";
import type { HoldingsSnapshot } from "@/domain/etf";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

function cacheTtlSeconds() {
  const configured = Number(process.env.HOLDINGS_CACHE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_SECONDS;
}

export async function getHoldingsSnapshot(
  ticker: string,
): Promise<HoldingsSnapshot> {
  const etf = getEtfByTicker(ticker);
  if (!etf) {
    throw new Error(`ETF non pris en charge : ${ticker}`);
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
      throw new Error(`Source iShares indisponible (${response.status}).`);
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
    const fallback = getSeedSnapshot(etf.ticker);
    return {
      ...fallback,
      warning:
        error instanceof Error
          ? `Source en ligne indisponible : ${error.message} Données de démonstration utilisées.`
          : "Source en ligne indisponible. Données de démonstration utilisées.",
    };
  }
}
