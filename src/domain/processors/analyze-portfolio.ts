import type {
  PortfolioAnalysis,
  PortfolioAnalysisInput,
  PortfolioContribution,
  PortfolioLookThroughPosition,
  PortfolioSecurity,
} from "../portfolio";
import { economicSecurityIdentity } from "../security-equivalence";
import { normalizeHoldingWeights } from "./normalize-holding-weights";

const EPSILON = 0.000001;

function roundWeight(value: number): number {
  return Math.round(value * 10_000_000_000) / 10_000_000_000;
}

function addPosition(
  positions: Map<string, PortfolioLookThroughPosition>,
  security: PortfolioSecurity,
  weight: number,
  contribution: PortfolioContribution,
) {
  if (!Number.isFinite(weight) || weight <= 0) return;

  const identity = economicSecurityIdentity(security);
  const existing = positions.get(identity.securityId);
  if (existing) {
    existing.weight += weight;
    const source = existing.contributions.find(
      (item) => item.itemId === contribution.itemId,
    );
    if (source) {
      source.weight += contribution.weight;
    } else {
      existing.contributions.push(contribution);
    }
    return;
  }

  positions.set(identity.securityId, {
    ...security,
    ...identity,
    weight,
    contributions: [contribution],
  });
}

export function analyzePortfolio({
  items,
  etfSnapshots,
  directSecurities,
  calculatedAt = new Date().toISOString(),
}: PortfolioAnalysisInput): PortfolioAnalysis {
  const allocationWeight = items.reduce(
    (sum, item) => sum + item.allocationWeight,
    0,
  );

  if (allocationWeight > 100 + EPSILON) {
    throw new Error("Portfolio allocations cannot exceed 100%.");
  }

  const positions = new Map<string, PortfolioLookThroughPosition>();

  for (const item of items) {
    if (!Number.isFinite(item.allocationWeight) || item.allocationWeight <= 0) {
      throw new Error("Every portfolio allocation must be greater than 0%.");
    }

    if (item.kind === "security") {
      const security = directSecurities.get(item.referenceId);
      if (!security) {
        throw new Error(`Security ${item.ticker} is no longer available.`);
      }
      addPosition(positions, security, item.allocationWeight, {
        itemId: item.id,
        ticker: item.ticker,
        kind: item.kind,
        weight: item.allocationWeight,
      });
      continue;
    }

    const snapshot =
      etfSnapshots.get(item.referenceId) ?? etfSnapshots.get(item.ticker);
    if (!snapshot) {
      throw new Error(`Holdings for ${item.ticker} are unavailable.`);
    }
    const calculationHoldings = normalizeHoldingWeights(
      snapshot.holdings,
      snapshot.etf.exposureMultiplier ?? 1,
    );
    const sourceTotal = calculationHoldings.reduce(
      (sum, holding) => sum + holding.weight,
      0,
    );
    if (sourceTotal <= EPSILON) {
      throw new Error(`Holdings for ${item.ticker} have no usable weight.`);
    }

    for (const holding of calculationHoldings) {
      const weight = item.allocationWeight * (holding.weight / 100);
      addPosition(
        positions,
        {
          securityId: holding.securityId,
          ticker: holding.ticker,
          name: holding.name,
          sector: holding.sector,
          assetClass: holding.assetClass,
          country: holding.country,
        },
        weight,
        {
          itemId: item.id,
          ticker: item.ticker,
          kind: item.kind,
          weight,
        },
      );
    }
  }

  const rawRankedPositions = [...positions.values()].sort(
    (left, right) => right.weight - left.weight,
  );
  const rankedPositions = rawRankedPositions.map((position) => ({
    ...position,
    weight: roundWeight(position.weight),
    contributions: position.contributions
      .map((contribution) => ({
        ...contribution,
        weight: roundWeight(contribution.weight),
      }))
      .sort((left, right) => right.weight - left.weight),
  }));

  const sectors = new Map<string, number>();
  for (const position of rawRankedPositions) {
    sectors.set(
      position.sector,
      (sectors.get(position.sector) ?? 0) + position.weight,
    );
  }

  return {
    calculatedAt,
    allocationWeight: roundWeight(allocationWeight),
    cashWeight: roundWeight(Math.max(0, 100 - allocationWeight)),
    positionsCount: rankedPositions.length,
    directPositionsCount: items.filter((item) => item.kind === "security").length,
    etfSleevesCount: items.filter((item) => item.kind === "etf").length,
    top10Concentration: roundWeight(
      rawRankedPositions
        .slice(0, 10)
        .reduce((sum, position) => sum + position.weight, 0),
    ),
    positions: rankedPositions,
    sectors: [...sectors.entries()]
      .map(([sector, weight]) => ({ sector, weight: roundWeight(weight) }))
      .sort((left, right) => right.weight - left.weight),
    sources: [...etfSnapshots.values()].map((snapshot) => ({
      referenceId: snapshot.etf.id ?? snapshot.etf.ticker,
      ticker: snapshot.etf.ticker,
      asOf: snapshot.asOf,
      sourceStatus: snapshot.sourceStatus,
      constituentCoverage: snapshot.constituentCoverage,
    })),
  };
}
