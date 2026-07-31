import type {
  ComparisonResult,
  Holding,
  HoldingsSnapshot,
  ImplicitSleeve,
  SectorComparison,
  SleevePosition,
} from "@/domain/etf";

import { normalizeHoldingWeights } from "./normalize-holding-weights";

const round = (value: number, decimals = 2) =>
  Number(value.toFixed(decimals));

const roundPositionWeight = (value: number) => round(value, 10);

function topConcentration(holdings: Holding[], count: number) {
  return round(
    [...holdings]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, count)
      .reduce((sum, holding) => sum + holding.weight, 0),
  );
}

function buildSectorComparison(
  left: Holding[],
  right: Holding[],
): SectorComparison[] {
  const sectors = new Map<string, { left: number; right: number }>();

  for (const holding of left) {
    const current = sectors.get(holding.sector) ?? { left: 0, right: 0 };
    current.left += holding.weight;
    sectors.set(holding.sector, current);
  }
  for (const holding of right) {
    const current = sectors.get(holding.sector) ?? { left: 0, right: 0 };
    current.right += holding.weight;
    sectors.set(holding.sector, current);
  }

  return [...sectors.entries()]
    .map(([sector, values]) => ({
      sector,
      left: round(values.left),
      right: round(values.right),
      delta: round(values.left - values.right),
    }))
    .sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right));
}

function buildImplicitSleeve(
  positions: SleevePosition[],
  side: "left" | "right",
  sourceTicker: string,
  relativeToTicker: string,
  sourceActiveWeight: number,
): ImplicitSleeve {
  const activeWeightKey =
    side === "left" ? "leftActiveWeight" : "rightActiveWeight";
  const activePositions = positions.filter(
    (position) => position[activeWeightKey] > 0,
  );
  const normalizationBase = activePositions.reduce(
    (sum, position) => sum + position[activeWeightKey],
    0,
  );
  const normalizedPositions =
    normalizationBase > 0
      ? activePositions
          .map((position) => ({
            securityId: position.securityId,
            ticker: position.ticker,
            name: position.name,
            sector: position.sector,
            activeWeight: roundPositionWeight(position[activeWeightKey]),
            normalizedWeight: roundPositionWeight(
              (position[activeWeightKey] / normalizationBase) * 100,
            ),
          }))
          .sort((a, b) => b.normalizedWeight - a.normalizedWeight)
      : [];
  const roundedTotal = roundPositionWeight(
    normalizedPositions.reduce(
      (sum, position) => sum + position.normalizedWeight,
      0,
    ),
  );
  const roundingAdjustment = roundPositionWeight(100 - roundedTotal);

  if (normalizedPositions.length > 0 && roundingAdjustment !== 0) {
    normalizedPositions[0] = {
      ...normalizedPositions[0],
      normalizedWeight: roundPositionWeight(
        normalizedPositions[0].normalizedWeight + roundingAdjustment,
      ),
    };
    normalizedPositions.sort(
      (a, b) => b.normalizedWeight - a.normalizedWeight,
    );
  }

  return {
    sourceTicker,
    relativeToTicker,
    sourceActiveWeight: roundPositionWeight(sourceActiveWeight),
    positionsCount: normalizedPositions.length,
    top10Concentration: round(
      normalizedPositions
        .slice(0, 10)
        .reduce((sum, position) => sum + position.normalizedWeight, 0),
    ),
    positions: normalizedPositions,
  };
}

export function compareHoldings(
  leftSnapshot: HoldingsSnapshot,
  rightSnapshot: HoldingsSnapshot,
): ComparisonResult {
  const leftHoldings = normalizeHoldingWeights(leftSnapshot.holdings);
  const rightHoldings = normalizeHoldingWeights(rightSnapshot.holdings);
  const leftMap = new Map(leftHoldings.map((holding) => [holding.securityId, holding]));
  const rightMap = new Map(rightHoldings.map((holding) => [holding.securityId, holding]));
  const securityIds = new Set([...leftMap.keys(), ...rightMap.keys()]);

  const rawPositions = [...securityIds]
    .map((securityId) => {
      const left = leftMap.get(securityId);
      const right = rightMap.get(securityId);
      const leftWeight = left?.weight ?? 0;
      const rightWeight = right?.weight ?? 0;
      const overlapWeight = Math.min(leftWeight, rightWeight);
      return {
        securityId,
        ticker: left?.ticker ?? right?.ticker ?? "—",
        name: left?.name ?? right?.name ?? "Unknown security",
        sector: left?.sector ?? right?.sector ?? "Unclassified",
        leftWeight,
        overlapWeight,
        rightWeight,
        leftActiveWeight: Math.max(leftWeight - rightWeight, 0),
        rightActiveWeight: Math.max(rightWeight - leftWeight, 0),
      };
    })
    .sort(
      (a, b) =>
        Math.max(b.leftActiveWeight, b.rightActiveWeight, b.overlapWeight) -
        Math.max(a.leftActiveWeight, a.rightActiveWeight, a.overlapWeight),
    );

  const rawOverlapWeight = rawPositions.reduce(
    (sum, position) => sum + position.overlapWeight,
    0,
  );
  const rawActiveSleeveWeight = Math.max(0, 100 - rawOverlapWeight);
  const overlapWeight = round(rawOverlapWeight);
  const activeSleeveWeight = round(rawActiveSleeveWeight);
  const leftImplicitSleeve = buildImplicitSleeve(
    rawPositions,
    "left",
    leftSnapshot.etf.ticker,
    rightSnapshot.etf.ticker,
    rawActiveSleeveWeight,
  );
  const rightImplicitSleeve = buildImplicitSleeve(
    rawPositions,
    "right",
    rightSnapshot.etf.ticker,
    leftSnapshot.etf.ticker,
    rawActiveSleeveWeight,
  );
  const positions: SleevePosition[] = rawPositions.map((position) => ({
    ...position,
    leftWeight: roundPositionWeight(position.leftWeight),
    overlapWeight: roundPositionWeight(position.overlapWeight),
    rightWeight: roundPositionWeight(position.rightWeight),
    leftActiveWeight: roundPositionWeight(position.leftActiveWeight),
    rightActiveWeight: roundPositionWeight(position.rightActiveWeight),
  }));

  return {
    left: {
      etf: leftSnapshot.etf,
      asOf: leftSnapshot.asOf,
      sourceStatus: leftSnapshot.sourceStatus,
      holdingsCount: leftSnapshot.holdings.length,
      top10Concentration: topConcentration(leftHoldings, 10),
    },
    right: {
      etf: rightSnapshot.etf,
      asOf: rightSnapshot.asOf,
      sourceStatus: rightSnapshot.sourceStatus,
      holdingsCount: rightSnapshot.holdings.length,
      top10Concentration: topConcentration(rightHoldings, 10),
    },
    calculatedAt: new Date().toISOString(),
    cacheTtlHours: Math.min(
      leftSnapshot.cacheTtlHours,
      rightSnapshot.cacheTtlHours,
    ),
    overlapWeight,
    leftActiveWeight: activeSleeveWeight,
    rightActiveWeight: activeSleeveWeight,
    sharedPositionsCount: positions.filter((position) => position.overlapWeight > 0)
      .length,
    positions,
    implicitSleeves: {
      left: leftImplicitSleeve,
      right: rightImplicitSleeve,
    },
    sectorComparison: buildSectorComparison(leftHoldings, rightHoldings),
  };
}
