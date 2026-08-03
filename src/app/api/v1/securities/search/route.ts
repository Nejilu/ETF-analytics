import {
  getHoldingsSnapshot,
  HoldingsUnavailableError,
} from "@/data/services/holdings-service";
import { securityQuoteAlias } from "@/domain/security-equivalence";
import { cacheControlForSource } from "@/domain/http-cache";

const MAX_RESULTS = 12;

function normalized(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

export async function GET(request: Request) {
  const query = normalized(new URL(request.url).searchParams.get("q") ?? "");
  if (query.length < 2) {
    return Response.json({ data: [] });
  }

  try {
    const acwi = await getHoldingsSnapshot("ACWI");
    const matches = acwi.holdings
      .map((holding) => ({
        holding,
        alias: securityQuoteAlias(holding),
      }))
      .filter(({ holding, alias }) => {
        if (!holding.ticker || holding.ticker === "—") return false;
        const searchable = [
          holding.ticker,
          holding.name,
          alias?.displayTicker,
          alias?.providerSymbol,
          alias?.instrumentType,
        ]
          .filter((value): value is string => Boolean(value))
          .map(normalized);
        return searchable.some((value) => value.includes(query));
      })
      .sort((left, right) => {
        const score = (candidate: typeof left) => {
          const tickers = [
            candidate.alias?.displayTicker,
            candidate.alias?.providerSymbol,
            candidate.holding.ticker,
          ]
            .filter((value): value is string => Boolean(value))
            .map(normalized);
          return tickers.includes(query)
            ? 0
            : tickers.some((ticker) => ticker.startsWith(query))
              ? 1
              : 2;
        };
        return (
          score(left) - score(right) ||
          right.holding.weight - left.holding.weight
        );
      })
      .slice(0, MAX_RESULTS)
      .map(({ holding, alias }) => ({
        securityId: holding.securityId,
        ticker: alias?.displayTicker ?? holding.ticker,
        name: holding.name,
        sector: holding.sector,
        country: holding.country,
        quoteSymbol: alias?.providerSymbol,
        instrumentType: alias?.instrumentType,
        underlyingTicker: alias?.underlyingTicker,
      }));

    return Response.json(
      {
        data: matches,
        meta: {
          universe: "ACWI",
          asOf: acwi.asOf,
          sourceStatus: acwi.sourceStatus,
        },
      },
      {
        headers: {
          "Cache-Control": cacheControlForSource(acwi.sourceStatus, "private, max-age=60"),
        },
      },
    );
  } catch (error) {
    if (error instanceof HoldingsUnavailableError) {
      return Response.json(
        {
          error:
            "The ACWI security universe is unavailable. Try again when the iShares source is reachable.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "Security search failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
