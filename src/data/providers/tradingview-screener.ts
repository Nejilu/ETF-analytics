import { SOURCE_METRIC_DEFINITIONS, type MetricKey } from "@/domain/metrics";

const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/global/scan";
const IDENTITY_COLUMNS = ["name", "description", "sector"] as const;

export interface TradingViewSecurityMetrics {
  symbol: string;
  ticker: string | null;
  description: string | null;
  sector: string | null;
  values: Partial<Record<MetricKey, number>>;
}

interface ScanResponse {
  data?: Array<{ s?: unknown; d?: unknown }>;
  error?: unknown;
}

function batchSize(): number {
  const configured = Number(process.env.TRADINGVIEW_BATCH_SIZE);
  return Number.isInteger(configured) && configured >= 25 && configured <= 1_000
    ? configured
    : 500;
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseTradingViewScanResponse(payload: unknown): TradingViewSecurityMetrics[] {
  if (!payload || typeof payload !== "object") throw new Error("TradingView returned an invalid response.");
  const response = payload as ScanResponse;
  if (!Array.isArray(response.data)) {
    const detail = typeof response.error === "string" ? `: ${response.error}` : "";
    throw new Error(`TradingView Screener response does not contain data${detail}.`);
  }
  return response.data.flatMap((row) => {
    if (typeof row.s !== "string" || !Array.isArray(row.d)) return [];
    const data = row.d;
    const values: Partial<Record<MetricKey, number>> = {};
    SOURCE_METRIC_DEFINITIONS.forEach((definition, index) => {
      const value = finiteNumber(data[IDENTITY_COLUMNS.length + index]);
      if (value !== undefined) values[definition.key] = value;
    });
    return [{
      symbol: row.s,
      ticker: typeof data[0] === "string" ? data[0] : null,
      description: typeof data[1] === "string" ? data[1] : null,
      sector: typeof data[2] === "string" ? data[2] : null,
      values,
    }];
  });
}

async function scanBatch(symbols: string[], fetcher: typeof fetch): Promise<TradingViewSecurityMetrics[]> {
  const response = await fetcher(TRADINGVIEW_SCAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "IndexLens/0.1 metrics research",
    },
    body: JSON.stringify({
      symbols: { tickers: symbols, query: { types: [] } },
      columns: [
        ...IDENTITY_COLUMNS,
        ...SOURCE_METRIC_DEFINITIONS.map((definition) => definition.tradingViewColumn),
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`TradingView Screener returned HTTP ${response.status}.`);
  }
  return parseTradingViewScanResponse(await response.json());
}

export async function fetchTradingViewMetrics(
  symbols: string[],
  fetcher: typeof fetch = fetch,
): Promise<TradingViewSecurityMetrics[]> {
  const uniqueSymbols = [...new Set(symbols)].sort();
  if (uniqueSymbols.length === 0) return [];
  const groups = batches(uniqueSymbols, batchSize());
  const output: TradingViewSecurityMetrics[] = [];
  const concurrency = Math.min(3, groups.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < groups.length) {
      const index = next;
      next += 1;
      output.push(...await scanBatch(groups[index], fetcher));
    }
  }));
  return output;
}
