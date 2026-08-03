import type { PortfolioAssetKind } from "./portfolio";

export function marketPriceInFlightKey(
  databasePath: string,
  assetKind: PortfolioAssetKind,
  assetId: string,
): string {
  return `${databasePath}::${assetKind}:${assetId}`;
}

export function fxRateInFlightKey(databasePath: string, currency: string): string {
  return `${databasePath}::fx:${currency.toUpperCase()}`;
}
