import {
  getMetricsOverview,
  MetricsOverviewRequestError,
  MetricsOverviewUnavailableError,
} from "@/data/services/metrics-overview-service";
import { metricsOverviewHttpResponse } from "./etag";

export async function GET(request: Request) {
  const references = new URL(request.url).searchParams
    .get("etfs")
    ?.split(",")
    .map((reference) => reference.trim())
    .filter(Boolean) ?? [];
  try {
    const result = await getMetricsOverview(references);
    return metricsOverviewHttpResponse(
      result,
      request.headers.get("if-none-match"),
    );
  } catch (error) {
    const unavailable = error instanceof MetricsOverviewUnavailableError;
    const invalidRequest = error instanceof MetricsOverviewRequestError;
    const status = invalidRequest ? 400 : unavailable ? 503 : 500;
    return Response.json(
      {
        error: status === 500
          ? "Metrics overview failed."
          : error instanceof Error
            ? error.message
            : "Metrics are unavailable.",
      },
      {
        status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
