import type { Holding } from "@/domain/etf";

interface ParsedHoldingsFile {
  asOf: string;
  holdings: Holding[];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value.trim());
    rows.push(row);
  }
  return rows;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.replace(/[%,$\s]/g, "").replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findColumn(headers: string[], candidates: string[]) {
  const normalized = headers.map((header) => header.toLowerCase().trim());
  return normalized.findIndex((header) =>
    candidates.some((candidate) => header === candidate.toLowerCase()),
  );
}

function valueAt(row: string[], index: number, fallback = "") {
  return index >= 0 ? row[index] || fallback : fallback;
}

function parseDate(rows: string[][]): string {
  const metadata = rows.find((row) =>
    row[0]?.toLowerCase().includes("holdings as of"),
  );
  const value = metadata?.[1];
  if (!value) return new Date().toISOString().slice(0, 10);
  const dayFirst = value.match(/^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{4})$/);
  const monthFirst = value.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const parts = dayFirst
    ? {
        day: Number(dayFirst[1]),
        month: months.indexOf(dayFirst[2].toLowerCase()) + 1,
        year: Number(dayFirst[3]),
      }
    : monthFirst
      ? {
          day: Number(monthFirst[2]),
          month: months.indexOf(monthFirst[1].toLowerCase()) + 1,
          year: Number(monthFirst[3]),
        }
      : null;
  if (parts && parts.month > 0) {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

export function parseIsharesHoldingsCsv(raw: string): ParsedHoldingsFile {
  const rows = parseCsv(raw.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex(
    (row) =>
      row.some((cell) => cell.toLowerCase().includes("weight")) &&
      row.some((cell) => cell.toLowerCase() === "name"),
  );

  if (headerIndex < 0) {
    throw new Error("Unable to locate the iShares file headers.");
  }

  const headers = rows[headerIndex];
  const tickerIndex = findColumn(headers, ["Ticker", "Issuer Ticker"]);
  const nameIndex = findColumn(headers, ["Name"]);
  const sectorIndex = findColumn(headers, ["Sector"]);
  const assetClassIndex = findColumn(headers, ["Asset Class"]);
  const weightIndex = findColumn(headers, ["Weight (%)", "Weight"]);
  const marketValueIndex = findColumn(headers, ["Market Value"]);
  const countryIndex = findColumn(headers, ["Location", "Country"]);
  const isinIndex = findColumn(headers, ["ISIN"]);
  const currencyIndex = findColumn(headers, ["Currency", "Market Currency"]);

  const parsedHoldings = rows
    .slice(headerIndex + 1)
    .map((row): Holding | null => {
      const name = valueAt(row, nameIndex);
      const ticker = valueAt(row, tickerIndex, "—");
      const weight = toNumber(valueAt(row, weightIndex));
      const marketValue = toNumber(valueAt(row, marketValueIndex));
      const isin = valueAt(row, isinIndex);
      if (!name || (weight <= 0 && marketValue <= 0)) return null;

      return {
        securityId:
          isin || `NAME:${name.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
        ticker,
        name,
        sector: valueAt(row, sectorIndex, "Unclassified"),
        assetClass: valueAt(row, assetClassIndex, "Unclassified"),
        country: valueAt(row, countryIndex, "Not reported"),
        isin: isin || undefined,
        weight,
        marketValue: marketValue || undefined,
        currency: valueAt(row, currencyIndex) || undefined,
      };
    })
    .filter((holding): holding is Holding => holding !== null);

  const holdingsBySecurity = new Map<string, Holding>();
  for (const holding of parsedHoldings) {
    const existing = holdingsBySecurity.get(holding.securityId);
    if (!existing) {
      holdingsBySecurity.set(holding.securityId, holding);
      continue;
    }

    existing.weight += holding.weight;
    if (holding.marketValue !== undefined) {
      existing.marketValue =
        (existing.marketValue ?? 0) + holding.marketValue;
    }
  }
  const holdings = [...holdingsBySecurity.values()];

  if (holdings.length < 5) {
    throw new Error("The iShares file does not contain enough holdings.");
  }

  return { asOf: parseDate(rows), holdings };
}
