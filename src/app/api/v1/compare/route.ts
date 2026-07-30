import { getEtfByTicker } from "@/data/catalog";
import { getHoldingsSnapshot } from "@/data/services/holdings-service";
import { compareHoldings } from "@/domain/processors/compare-holdings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const leftTicker = url.searchParams.get("left")?.toUpperCase() ?? "";
  const rightTicker = url.searchParams.get("right")?.toUpperCase() ?? "";

  if (!getEtfByTicker(leftTicker) || !getEtfByTicker(rightTicker)) {
    return Response.json(
      {
        error:
          "Sélection invalide. Utilisez deux tickers présents dans le catalogue.",
      },
      { status: 400 },
    );
  }

  const [left, right] = await Promise.all([
    getHoldingsSnapshot(leftTicker),
    getHoldingsSnapshot(rightTicker),
  ]);

  return Response.json(
    { data: compareHoldings(left, right) },
    {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600",
      },
    },
  );
}
