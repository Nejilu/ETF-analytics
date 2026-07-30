import type {
  ComparisonResult,
  Holding,
  HoldingsSnapshot,
  SectorComparison,
  SleevePosition,
} from "@/domain/etf";

const round = (value: number, decimals = 2) =>
  Number(value.toFixed(decimals));

function normalize(holdings: Holding[]): Holding[] {
  const total = holdings.reduce((sum, holding) => sum + holding.weight, 0);
  if (total <= 0) return holdings;
  return holdings.map((holding) => ({
    ...holding,
    weight: (holding.weight / total) * 100,
  }));
}

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

export function compareHoldings(
  leftSnapshot: HoldingsSnapshot,
  rightSnapshot: HoldingsSnapshot,
): ComparisonResult {
  const leftHoldings = normalize(leftSnapshot.holdings);
  const rightHoldings = normalize(rightSnapshot.holdings);
  const leftMap = new Map(leftHoldings.map((holding) => [holding.securityId, holding]));
  const rightMap = new Map(rightHoldings.map((holding) => [holding.securityId, holding]));
  const securityIds = new Set([...leftMap.keys(), ...rightMap.keys()]);

  const positions: SleevePosition[] = [...securityIds]
    .map((securityId) => {
      const left = leftMap.get(securityId);
      const right = rightMap.get(securityId);
      const leftWeight = left?.weight ?? 0;
      const rightWeight = right?.weight ?? 0;
      const overlapWeight = Math.min(leftWeight, rightWeight);
      return {
        securityId,
        ticker: left?.ticker ?? right?.ticker ?? "—",
        name: left?.name ?? right?.name ?? "Titre inconnu",
        sector: left?.sector ?? right?.sector ?? "Non classé",
        leftWeight: round(leftWeight),
        overlapWeight: round(overlapWeight),
        rightWeight: round(rightWeight),
        leftActiveWeight: round(Math.max(leftWeight - rightWeight, 0)),
        rightActiveWeight: round(Math.max(rightWeight - leftWeight, 0)),
      };
    })
    .sort(
      (a, b) =>
        Math.max(b.leftActiveWeight, b.rightActiveWeight, b.overlapWeight) -
        Math.max(a.leftActiveWeight, a.rightActiveWeight, a.overlapWeight),
    );

  const overlapWeight = round(
    positions.reduce((sum, position) => sum + position.overlapWeight, 0),
  );

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
    leftActiveWeight: round(100 - overlapWeight),
    rightActiveWeight: round(100 - overlapWeight),
    sharedPositionsCount: positions.filter((position) => position.overlapWeight > 0)
      .length,
    positions,
    sectorComparison: buildSectorComparison(leftHoldings, rightHoldings),
  };
}
