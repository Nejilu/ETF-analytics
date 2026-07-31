import {
  getHoldingsSnapshot,
  HoldingsUnavailableError,
} from "@/data/services/holdings-service";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { findEtfByReference } from "@/db/repositories/catalog-repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  ensureLocalDatabase();
  if (!findEtfByReference(ticker)) {
    return Response.json({ error: "Unsupported ETF." }, { status: 404 });
  }

  try {
    const snapshot = await getHoldingsSnapshot(ticker);
    return Response.json(
      { data: snapshot },
      {
        headers: {
          "Cache-Control":
            snapshot.sourceStatus === "stale"
              ? "no-store"
              : "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    if (error instanceof HoldingsUnavailableError) {
      return Response.json(
        {
          error: `${error.message} No substitute figures are shown.`,
          unavailable: [error.reference],
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
