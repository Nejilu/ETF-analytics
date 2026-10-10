import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import { databasePath } from "@/db/client";
import { findSecuritiesByIds } from "@/db/repositories/catalog-repository";
import { loadProviderSymbols } from "@/db/repositories/metrics-repository";
import { resolvedProviderSymbol } from "@/domain/metrics-cache";
import type { StockMetricsResult } from "@/domain/stock-metrics";
import { buildStockMetricsResult } from "./stock-metrics-model";
import { loadUpcomingEarnings } from "@/db/repositories/upcoming-earnings-repository";
import { upcomingEarningsView } from "@/domain/upcoming-earnings";
import { getAdrPremium } from "./adr-premium-service";
import { adrPairForListing } from "@/domain/adr-premium";
import { securityQuoteAlias } from "@/domain/security-equivalence";
import {
  retrieveSecurityMetrics,
  MetricsOverviewUnavailableError,
  type MetricsRefreshOptions,
} from "./security-metrics-service";

const inFlightRequests = new Map<string, Promise<StockMetricsResult>>();

export class StockMetricsRequestError extends Error {}

export function getStockMetrics(
  securityId: string,
  options: MetricsRefreshOptions = {},
): Promise<StockMetricsResult> {
  if (!securityId || securityId.length > 200) {
    return Promise.reject(new StockMetricsRequestError("Select a stock from the search results."));
  }
  try {
    ensureLocalDatabase();
    const security = findSecuritiesByIds([securityId]).get(securityId);
    if (!security || !security.assetClass.toLowerCase().includes("equity")) {
      return Promise.reject(new StockMetricsRequestError("The selected stock is unavailable."));
    }
    const key = `${databasePath()}::${securityId}`;
    const requestKey = `${key}::${options.forceRefresh ? "force" : "cached"}`;
    const existing = inFlightRequests.get(requestKey)
      ?? (!options.forceRefresh ? inFlightRequests.get(`${key}::force`) : undefined);
    if (existing) return existing;
    const holding = { ...security, weight: 100 };
    const quoteAlias = securityQuoteAlias(security);
    const adrListing = { ...security, priceSymbol: quoteAlias?.providerSymbol };
    const requestStartedAt = Date.now();
    const request = Promise.all([
      retrieveSecurityMetrics([holding], { ...options, includeUpcomingEarnings: true }),
      adrPairForListing(adrListing) ? getAdrPremium(adrListing, options.forceRefresh) : Promise.resolve(null),
    ]).then(([result, adrPremium]) => {
      const { metricsBySecurity, resolvedSecurityIds, ...metadata } = result;
      const observations = metricsBySecurity.get(securityId);
      const providerSymbol = observations?.providerSymbol
        ?? (resolvedSecurityIds.has(securityId)
          ? resolvedProviderSymbol(loadProviderSymbols([securityId]).get(securityId)) : "");
      return {
        ...buildStockMetricsResult(holding, observations, metadata, providerSymbol),
        adrPremium,
        upcomingEarnings: upcomingEarningsView(loadUpcomingEarnings([securityId]).get(securityId),
          providerSymbol, metadata.cacheTtlHours * 3_600, requestStartedAt,
          metadata.sourceWarnings.includes("screener-unavailable")),
      };
    }).finally(() => inFlightRequests.delete(requestKey));
    inFlightRequests.set(requestKey, request);
    return request;
  } catch (error) {
    return Promise.reject(new MetricsOverviewUnavailableError(error));
  }
}
