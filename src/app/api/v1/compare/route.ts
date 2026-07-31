import {
  getHoldingsSnapshot,
  HoldingsUnavailableError,
} from "@/data/services/holdings-service";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { findEtfByReference } from "@/db/repositories/catalog-repository";
import { compareHoldings } from "@/domain/processors/compare-holdings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const leftReference = url.searchParams.get("left")?.trim() ?? "";
  const rightReference = url.searchParams.get("right")?.trim() ?? "";

  ensureLocalDatabase();
  if (
    !findEtfByReference(leftReference) ||
    !findEtfByReference(rightReference)
  ) {
    return Response.json(
      {
        error:
          "Invalid selection. Use two tickers available in the catalog.",
      },
      { status: 400 },
    );
  }

  const snapshots = await Promise.allSettled([
    getHoldingsSnapshot(leftReference),
    getHoldingsSnapshot(rightReference),
  ]);

  const unavailable = snapshots.flatMap((result) =>
    result.status === "rejected" &&
    result.reason instanceof HoldingsUnavailableError
      ? [result.reason.reference]
      : [],
  );

  if (snapshots.some((result) => result.status === "rejected")) {
    return Response.json(
      {
        error:
          unavailable.length > 0
            ? `Data unavailable for ${unavailable.join(" and ")}. No substitute figures are shown.`
            : "Source data is temporarily unavailable.",
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
