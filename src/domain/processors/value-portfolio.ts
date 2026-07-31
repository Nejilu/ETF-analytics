import type { MarketPrice, PortfolioItem } from "../portfolio";

export function valuePortfolioPositions(
  items: PortfolioItem[],
  prices: ReadonlyMap<string, MarketPrice>,
): { items: PortfolioItem[]; totalMarketValueUsd: number } {
  const valued = items.map((item) => {
    const price = prices.get(`${item.kind}:${item.referenceId}`);
    if (!price) throw new Error(`Price for ${item.ticker} is unavailable.`);
    const fallbackValue =
      item.initialValueUsd ??
      (item.allocationWeight > 0 ? item.allocationWeight : undefined);
    const quantity =
      item.quantity ??
      (item.inputMode === "shares" && item.inputAmount
        ? item.inputAmount
        : fallbackValue
          ? fallbackValue / price.priceUsd
          : undefined);
    if (!quantity || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`A valid share quantity is required for ${item.ticker}.`);
    }
    return {
      ...item,
      quantity,
      priceSymbol: price.providerSymbol,
      priceCurrency: price.currency,
      currentPrice: price.price,
      currentPriceUsd: price.priceUsd,
      currentValueUsd: quantity * price.priceUsd,
      priceAsOf: price.asOf,
      priceStatus: price.sourceStatus,
    };
  });
  const totalMarketValueUsd = valued.reduce(
    (sum, item) => sum + (item.currentValueUsd ?? 0),
    0,
  );
  if (totalMarketValueUsd <= 0) {
    throw new Error("The portfolio has no positive market value.");
  }

  return {
    items: valued.map((item) => ({
      ...item,
      allocationWeight:
        ((item.currentValueUsd ?? 0) / totalMarketValueUsd) * 100,
    })),
    totalMarketValueUsd,
  };
}
