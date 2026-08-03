import { createHash } from "node:crypto";

import type { MetricsOverviewResult } from "@/domain/metrics";

export function metricsCacheControl(status: MetricsOverviewResult["sourceStatus"]): string {
  if (status === "stale") return "no-store";
  if (status === "partial") return "private, max-age=60, stale-while-revalidate=300";
  return "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600";
}

export function metricsEtag(serializedBody: string): string {
  const digest = createHash("sha256")
    .update("metrics-overview-v3\0")
    .update(serializedBody)
    .digest("hex")
    .slice(0, 24);
  return `W/\"metrics-${digest}\"`;
}

export function serializeMetricsOverviewResult(result: MetricsOverviewResult): {
  body: string;
  etag: string;
} {
  const body = JSON.stringify({ data: result });
  return { body, etag: metricsEtag(body) };
}

export function metricsOverviewHttpResponse(
  result: MetricsOverviewResult,
  ifNoneMatch: string | null,
): Response {
  const { body, etag } = serializeMetricsOverviewResult(result);
  const headers = new Headers({
    "Cache-Control": metricsCacheControl(result.sourceStatus),
    ETag: etag,
  });
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(body, { status: 200, headers });
}

export function matchesIfNoneMatch(
  header: string | null,
  etag: string,
): boolean {
  if (!header) return false;
  const normalizedEtag = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === normalizedEtag);
}
