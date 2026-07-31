import {
  getHoldingsSnapshot,
  HoldingsUnavailableError,
} from "@/data/services/holdings-service";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { findEtfByTicker } from "@/db/repositories/catalog-repository";
import { compareHoldings } from "@/domain/processors/compare-holdings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const leftTicker = url.searchParams.get("left")?.toUpperCase() ?? "";
  const rightTicker = url.searchParams.get("right")?.toUpperCase() ?? "";

  ensureLocalDatabase();
  if (!findEtfByTicker(leftTicker) || !findEtfByTicker(rightTicker)) {
    return Response.json(
      {
        error:
          "Invalid selection. Use two tickers available in the catalog.",
      },
      { status: 400 },
    );
  }

  const snapshots = await Promise.allSettled([
    getHoldingsSnapshot(leftTicker),
    getHoldingsSnapshot(rightTicker),
  ]);

  const unavailable = snapshots.flatMap((result) =>
    result.status === "rejected" &&
    result.reason instanceof HoldingsUnavailableError
      ? [result.reason.ticker]
      : [],
  );

  if (snapshots.some((result) => result.status === "rejected")) {
    return Response.json(
      {
        error:
          unavailable.length > 0
            ? `Data unavailable for ${unavailable.join(" and ")}. No substitute figures are shown.`
            : "iShares data is temporarily unavailable.",
        unavailable,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const [left, right] = snapshots.map((result) => {
    if (result.status !== "fulfilled") {
      throw new Error("Inconsistent loading state.");
    }
    return result.value;
  });

  return Response.json(
    { data: compareHoldings(left, right) },
    {
      headers: {
        "Cache-Control":
          left.sourceStatus === "stale" ||
          right.sourceStatus === "stale"
            ? "no-store"
            : "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600",
      },
    },
  );
}
