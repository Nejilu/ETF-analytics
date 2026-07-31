import {
  getHoldingsSnapshot,
  HoldingsUnavailableError,
} from "@/data/services/holdings-service";

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
      .filter((holding) => {
        if (!holding.ticker || holding.ticker === "—") return false;
        const ticker = normalized(holding.ticker);
        const name = normalized(holding.name);
        return ticker.includes(query) || name.includes(query);
      })
      .sort((left, right) => {
        const leftTicker = normalized(left.ticker);
        const rightTicker = normalized(right.ticker);
        const leftScore = leftTicker === query ? 0 : leftTicker.startsWith(query) ? 1 : 2;
        const rightScore =
          rightTicker === query ? 0 : rightTicker.startsWith(query) ? 1 : 2;
        return leftScore - rightScore || right.weight - left.weight;
      })
      .slice(0, MAX_RESULTS)
      .map((holding) => ({
        securityId: holding.securityId,
        ticker: holding.ticker,
        name: holding.name,
        sector: holding.sector,
        country: holding.country,
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
          "Cache-Control": "private, max-age=60",
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
    throw error;
  }
}
