import type { EtfShareClass } from "@/domain/etf";

interface IsharesHoldingsFile {
  raw: string;
  sourceUrl: string;
}

const CSV_ACCEPT_HEADER = "text/csv,text/plain;q=0.9,*/*;q=0.8";
const LEGACY_UK_DOWNLOAD_ID = "1506575576011.ajax";
const CURRENT_CH_DOWNLOAD_ID = "1495092304805.ajax";

export function holdingsSourceCandidates(sourceUrl: string): string[] {
  const candidates = [sourceUrl];

  try {
    const fallback = new URL(sourceUrl);
    const isLegacyUkDownload =
      fallback.hostname === "www.ishares.com" &&
      fallback.pathname.includes("/uk/individual/en/") &&
      fallback.pathname.includes(`/${LEGACY_UK_DOWNLOAD_ID}`);

    if (isLegacyUkDownload) {
      fallback.pathname = fallback.pathname
        .replace("/uk/individual/en/", "/ch/individual/en/")
        .replace(LEGACY_UK_DOWNLOAD_ID, CURRENT_CH_DOWNLOAD_ID);
      candidates.push(fallback.toString());
    }
  } catch {
    // The primary URL will produce the actionable fetch error.
  }

  return [...new Set(candidates)];
}

export function assertCsvPayload(contentType: string, raw: string): void {
  const beginning = raw.trimStart().slice(0, 32).toLowerCase();
  if (
    contentType.toLowerCase().includes("text/html") ||
    beginning.startsWith("<!doctype html") ||
    beginning.startsWith("<html")
  ) {
    throw new Error("iShares returned an HTML page instead of a holdings CSV.");
  }
}

export async function fetchIsharesHoldingsFile(
  etf: EtfShareClass,
  ttlSeconds: number,
): Promise<IsharesHoldingsFile> {
  const failures: string[] = [];

  for (const sourceUrl of holdingsSourceCandidates(etf.holdingsUrl)) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          Accept: CSV_ACCEPT_HEADER,
          "User-Agent": "IndexLens/0.1 holdings-research",
        },
        next: {
          revalidate: ttlSeconds,
          tags: [`holdings:${etf.ticker}`],
        },
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const raw = await response.text();
      assertCsvPayload(response.headers.get("content-type") ?? "", raw);
      return { raw, sourceUrl };
    } catch (error) {
      failures.push(
        error instanceof Error ? error.message : "Unknown source error",
      );
    }
  }

  throw new Error(
    `iShares holdings CSV unavailable: ${failures.join("; ")}`,
  );
}
