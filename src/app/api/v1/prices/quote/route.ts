import { getMarketPrice } from "@/data/services/market-price-service";
import type { PortfolioAssetKind } from "@/domain/portfolio";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as PortfolioAssetKind | null;
  const referenceId = url.searchParams.get("referenceId")?.trim();
  if (
    (kind !== "etf" && kind !== "security") ||
    !referenceId ||
    referenceId.length > 100
  ) {
    return Response.json(
      { error: "A valid asset kind and reference id are required." },
      { status: 400 },
    );
  }

  try {
    const price = await getMarketPrice(kind, referenceId);
    return Response.json(
      { data: price },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The market price is unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
