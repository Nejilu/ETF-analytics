import { getEtfByTicker } from "@/data/catalog";
import {
  getHoldingsSnapshot,
  HoldingsUnavailableError,
} from "@/data/services/holdings-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  if (!getEtfByTicker(ticker)) {
    return Response.json({ error: "ETF non pris en charge." }, { status: 404 });
  }

  try {
    return Response.json(
      { data: await getHoldingsSnapshot(ticker) },
      {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    if (error instanceof HoldingsUnavailableError) {
      return Response.json(
        {
          error: `${error.message} Aucun chiffre de substitution n’est affiché.`,
          unavailable: [error.ticker],
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
