import {
  getMetricsOverview,
  MetricsOverviewUnavailableError,
} from "@/data/services/metrics-overview-service";

export async function GET(request: Request) {
  const references = new URL(request.url).searchParams
    .get("etfs")
    ?.split(",")
    .map((reference) => reference.trim())
    .filter(Boolean) ?? [];
  try {
    const result = await getMetricsOverview(references);
    return Response.json(
      { data: result },
      {
        headers: {
          "Cache-Control": result.sourceStatus === "stale"
            ? "no-store"
            : "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    const unavailable = error instanceof MetricsOverviewUnavailableError;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Metrics are unavailable.",
      },
      {
        status: unavailable ? 503 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
