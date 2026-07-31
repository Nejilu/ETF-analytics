import type { Holding } from "../etf";

const MAX_POSITION_DIFFERENCE = 0.1;
const MAX_TOTAL_DIFFERENCE = 5;

// Market values are preferred only when they reconcile closely with the
// official weights. This avoids treating derivative market value as exposure.
function normalizedBySourceWeight(holdings: Holding[]): Holding[] {
  const total = holdings.reduce(
    (sum, holding) => sum + Math.max(0, holding.weight),
    0,
  );
  if (total <= 0) return holdings;

  return holdings.map((holding) => ({
    ...holding,
    weight: (Math.max(0, holding.weight) / total) * 100,
  }));
}

function normalizedByMarketValue(holdings: Holding[]): Holding[] | null {
  if (
    holdings.length === 0 ||
    holdings.some(
      (holding) =>
        typeof holding.marketValue !== "number" ||
        !Number.isFinite(holding.marketValue) ||
        holding.marketValue <= 0,
    )
  ) {
    return null;
  }

  const total = holdings.reduce(
    (sum, holding) => sum + (holding.marketValue ?? 0),
    0,
  );
  if (!Number.isFinite(total) || total <= 0) return null;

  return holdings.map((holding) => ({
    ...holding,
    weight: ((holding.marketValue ?? 0) / total) * 100,
  }));
}

export function normalizeHoldingWeights(holdings: Holding[]): Holding[] {
  const sourceWeights = normalizedBySourceWeight(holdings);
  const marketValueWeights = normalizedByMarketValue(holdings);
  if (!marketValueWeights) return sourceWeights;

  const sourceTotal = sourceWeights.reduce(
    (sum, holding) => sum + holding.weight,
    0,
  );
  if (sourceTotal <= 0) return marketValueWeights;

  const differences = marketValueWeights.map((holding, index) =>
    Math.abs(holding.weight - sourceWeights[index].weight),
  );
  const maxDifference = Math.max(...differences);
  const totalDifference = differences.reduce(
    (sum, difference) => sum + difference,
    0,
  );

  return maxDifference <= MAX_POSITION_DIFFERENCE &&
    totalDifference <= MAX_TOTAL_DIFFERENCE
    ? marketValueWeights
    : sourceWeights;
}
