import { withSiteAccess } from "@/server/site-route";
import { getStockMetrics, StockMetricsRequestError } from "@/data/services/stock-metrics-service";
import { MetricsOverviewUnavailableError } from "@/data/services/security-metrics-service";

async function handleGET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await getStockMetrics(url.searchParams.get("securityId")?.trim() ?? "", {
      forceRefresh: url.searchParams.get("refresh") === "true",
    });
    return Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof StockMetricsRequestError ? 400
      : error instanceof MetricsOverviewUnavailableError ? 503 : 500;
    return Response.json({
      error: status === 500 ? "Stock metrics failed."
        : error instanceof Error ? error.message : "Stock metrics are unavailable.",
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = withSiteAccess(handleGET, "read");
