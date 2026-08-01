import "dotenv/config";

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

import Database from "better-sqlite3";

import { ensureLocalDatabase } from "../src/db/bootstrap";
import { getSqlite } from "../src/db/client";

interface SourceMapping {
  requestedTicker: string;
  holdingName: string | null;
  requestedExchange: string | null;
  requestedLocation: string | null;
  providerSymbol: string;
  fetchedAt: string;
}

interface TargetSecurity {
  id: string;
  ticker: string | null;
  name: string;
  country: string | null;
  identifiersJson: string | null;
  currentSymbol: string | null;
  currentStatus: string | null;
}

const DEFAULT_SOURCE = "mapping et desambiguation ticker tradingview/stocks.sqlite";
const sourcePath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_SOURCE);
if (!existsSync(sourcePath)) {
  throw new Error(`Mapping database not found: ${sourcePath}`);
}

function normalized(value: string | null): string {
  return (value ?? "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function words(value: string | null): Set<string> {
  return new Set(normalized(value).split(" ").filter((word) =>
    word.length > 2 && !["inc", "ltd", "plc", "corp", "class", "holding", "holdings"].includes(word)));
}

function nameScore(expected: string, actual: string | null): number {
  const left = words(expected);
  const right = words(actual);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return common / Math.min(left.size, right.size);
}

function sameCountry(left: string | null, right: string | null): boolean {
  const aliases: Record<string, string> = {
    "korea south": "south korea",
    korea: "south korea",
    "united states of america": "united states",
  };
  const normalizedLeft = aliases[normalized(left)] ?? normalized(left);
  const normalizedRight = aliases[normalized(right)] ?? normalized(right);
  return Boolean(normalizedLeft && normalizedLeft === normalizedRight);
}

function parseIdentifiers(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

ensureLocalDatabase();
const source = new Database(sourcePath, { readonly: true });
const target = getSqlite();
const sourceRows = source.prepare(`
  SELECT
    requested_ticker AS requestedTicker,
    holding_name AS holdingName,
    requested_exchange AS requestedExchange,
    requested_location AS requestedLocation,
    provider_symbol AS providerSymbol,
    fetched_at AS fetchedAt
  FROM quote_results
  WHERE provider = 'tradingview' AND ok = 1 AND provider_symbol LIKE '%:%'
  ORDER BY run_id DESC, request_id DESC
`).all() as SourceMapping[];

const byTicker = new Map<string, SourceMapping[]>();
const seen = new Set<string>();
for (const row of sourceRows) {
  const ticker = row.requestedTicker.trim().toLocaleUpperCase("en-US");
  const key = `${ticker}|${row.providerSymbol}`;
  if (!ticker || seen.has(key)) continue;
  seen.add(key);
  byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), row]);
}

const securities = target.prepare(`
  SELECT
    s.id,
    s.primary_ticker AS ticker,
    s.name,
    s.country,
    s.identifiers_json AS identifiersJson,
    p.provider_symbol AS currentSymbol,
    p.status AS currentStatus
  FROM securities s
  LEFT JOIN security_provider_symbols p
    ON p.security_id = s.id AND p.provider = 'tradingview'
`).all() as TargetSecurity[];

const upsertMapping = target.prepare(`
  INSERT INTO security_provider_symbols (
    provider, security_id, provider_symbol, status, confidence,
    last_verified_at, metadata_json
  ) VALUES ('tradingview', ?, ?, 'resolved', ?, ?, ?)
  ON CONFLICT(provider, security_id) DO UPDATE SET
    provider_symbol = excluded.provider_symbol,
    status = excluded.status,
    confidence = excluded.confidence,
    last_verified_at = excluded.last_verified_at,
    metadata_json = excluded.metadata_json
`);
const updateIdentifiers = target.prepare(
  "UPDATE securities SET identifiers_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
);

let imported = 0;
let exchangesBackfilled = 0;
let ambiguous = 0;
target.transaction(() => {
  for (const security of securities) {
    if (!security.ticker) continue;
    const candidates = byTicker.get(security.ticker.trim().toLocaleUpperCase("en-US")) ?? [];
    if (candidates.length === 0) continue;
    const ranked = candidates.map((candidate) => {
      const similarity = nameScore(security.name, candidate.holdingName);
      const countryMatch = sameCountry(security.country, candidate.requestedLocation);
      return {
        candidate,
        similarity,
        score: similarity * 0.8 + (countryMatch ? 0.2 : 0),
      };
    }).sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const distinctSymbols = new Set(candidates.map((candidate) => candidate.providerSymbol));
    const accepted = best && (
      best.similarity >= 0.5 ||
      (distinctSymbols.size === 1 && (best.similarity >= 0.25 || sameCountry(security.country, best.candidate.requestedLocation)))
    );
    if (!accepted) {
      ambiguous += 1;
      continue;
    }
    const mappingMatches = !security.currentSymbol || security.currentSymbol === best.candidate.providerSymbol;
    if (security.currentStatus !== "resolved" || !security.currentSymbol) {
      upsertMapping.run(
        security.id,
        best.candidate.providerSymbol,
        Math.min(0.99, Math.max(0.7, best.score)),
        best.candidate.fetchedAt,
        JSON.stringify({
          importedFrom: basename(sourcePath),
          ticker: security.ticker,
          requestedExchange: best.candidate.requestedExchange,
          requestedLocation: best.candidate.requestedLocation,
          holdingName: best.candidate.holdingName,
        }),
      );
      imported += 1;
    }
    if (mappingMatches && best.candidate.requestedExchange) {
      const identifiers = parseIdentifiers(security.identifiersJson);
      if (typeof identifiers.exchange !== "string" || !identifiers.exchange) {
        updateIdentifiers.run(JSON.stringify({
          ...identifiers,
          exchange: best.candidate.requestedExchange,
        }), security.id);
        exchangesBackfilled += 1;
      }
    }
  }
})();

source.close();
console.log(JSON.stringify({
  sourceMappings: seen.size,
  targetSecurities: securities.length,
  imported,
  exchangesBackfilled,
  ambiguous,
}, null, 2));
