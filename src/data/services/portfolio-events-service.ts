import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import { databasePath } from "@/db/client";
import { findSecuritiesByIds } from "@/db/repositories/catalog-repository";
import { ensureMetricDefinitions, loadLatestSecurityMetrics, loadProviderSymbols } from "@/db/repositories/metrics-repository";
import { loadUpcomingEarnings } from "@/db/repositories/upcoming-earnings-repository";
import { resolvedProviderSymbol } from "@/domain/metrics-cache";
import { orderEarningsEvents, PORTFOLIO_EVENT_POSITIONS_MAX, type SecurityEarningsEvent } from "@/domain/portfolio-events";
import { upcomingEarningsAreFresh, upcomingEarningsView } from "@/domain/upcoming-earnings";
import { prepareScreenerRefresh, refreshScreenerMetrics, ScreenerRefreshUnavailableError } from "./metrics-overview-screener";

export class PortfolioEventsRequestError extends Error {}

const inFlight = new Map<string, Promise<SecurityEarningsEvent[]>>();

export function getPortfolioEvents(securityIds: string[]): Promise<SecurityEarningsEvent[]> {
  const ids = [...new Set(securityIds)];
  if (!ids.length || ids.length > PORTFOLIO_EVENT_POSITIONS_MAX || ids.some((id) => !id || id.length > 200)) {
    return Promise.reject(new PortfolioEventsRequestError(`Select between 1 and ${PORTFOLIO_EVENT_POSITIONS_MAX} portfolio stocks.`));
  }
  ensureLocalDatabase();
  const key = `${databasePath()}::${ids.slice().sort().join("|")}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = loadEvents(ids).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function loadEvents(ids: string[]): Promise<SecurityEarningsEvent[]> {
  const startedAt = Date.now();
  const configuredTtl = Number(process.env.TRADINGVIEW_METRICS_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : 86_400;
  const securities = findSecuritiesByIds(ids);
  const holdings = ids.map((id) => {
    const security = securities.get(id);
    if (!security || !security.assetClass.toLowerCase().includes("equity")) {
      throw new PortfolioEventsRequestError("One of the selected stocks is unavailable.");
    }
    return { ...security, weight: 100 / ids.length };
  });
  let symbols = loadProviderSymbols(ids);
  const cached = loadUpcomingEarnings(ids);
  const toRefresh = holdings.filter((holding) => !upcomingEarningsAreFresh(
    cached.get(holding.securityId), resolvedProviderSymbol(symbols.get(holding.securityId)), ttlSeconds,
  ));
  let unavailable = false;
  if (toRefresh.length) {
    ensureMetricDefinitions();
    const refreshIds = toRefresh.map((holding) => holding.securityId);
    const cachedMetrics = loadLatestSecurityMetrics(refreshIds);
    const plan = prepareScreenerRefresh({
      holdings: toRefresh, providerSymbols: symbols, cachedMetrics, ttlSeconds,
      additionalRefreshSecurityIds: new Set(refreshIds),
    });
    try {
      const result = await refreshScreenerMetrics({
        ...plan, holdings: toRefresh, providerSymbols: symbols, cachedMetrics,
        securityIds: refreshIds, includeUpcomingEarnings: true, missingSourceMetricTtlMs: 900_000,
      });
      symbols = result.providerSymbols;
      unavailable = result.warnings.includes("screener-unavailable");
    } catch (error) {
      if (!(error instanceof ScreenerRefreshUnavailableError)) throw error;
      unavailable = true;
    }
  }
  const observations = loadUpcomingEarnings(ids);
  return orderEarningsEvents(holdings.map((holding) => {
    const observation = observations.get(holding.securityId);
    const failedRefresh = unavailable && toRefresh.some((candidate) => candidate.securityId === holding.securityId)
      && !(Date.parse(observation?.capturedAt ?? "") >= startedAt);
    return {
      securityId: holding.securityId, ticker: holding.ticker, name: holding.name,
      ...upcomingEarningsView(observation, resolvedProviderSymbol(symbols.get(holding.securityId)),
        ttlSeconds, startedAt, failedRefresh),
    };
  }));
}
