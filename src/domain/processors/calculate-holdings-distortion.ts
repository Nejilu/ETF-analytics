import {
  DEFAULT_DISTORTION_TOP_COUNT,
  type DistortionMode,
  type DistortionReferencePosition,
  type HoldingsAnalysisPosition,
  type HoldingsDistortionAnalysis,
} from "../holdings-analysis";

const round = (value: number) => Number(value.toFixed(6));

// Inputs have already been normalized and equivalent listings merged.
// Both distributions use positive equity exposure, excluding cash and shorts.
export function calculateHoldingsDistortion(
  positions: HoldingsAnalysisPosition[],
  referencePositions: DistortionReferencePosition[],
  reference: Pick<HoldingsDistortionAnalysis, "referenceEtfId" | "referenceTicker" | "referenceAsOf">,
  mode: DistortionMode = "top-holdings",
  topCount = DEFAULT_DISTORTION_TOP_COUNT,
): { distortion: HoldingsDistortionAnalysis; positions: HoldingsAnalysisPosition[] } {
  const equities = positions.filter((position) =>
    position.publishedWeight > 0 && position.assetClass.toLowerCase().includes("equity"),
  ).sort((a, b) => b.publishedWeight - a.publishedWeight || a.securityId.localeCompare(b.securityId));
  const count = Number.isFinite(topCount) ? Math.max(1, Math.trunc(topCount)) : DEFAULT_DISTORTION_TOP_COUNT;
  const selected = mode === "top-holdings" ? equities.slice(0, count) : equities;
  const acwi = referencePositions.filter((position) => position.weight > 0);
  const bySecurity = new Map(acwi.map((position) => [position.securityId, position]));
  const covered = selected.filter((position) => bySecurity.has(position.securityId));
  const selectedWeight = selected.reduce((sum, position) => sum + position.publishedWeight, 0);
  const coveredWeight = covered.reduce((sum, position) => sum + position.publishedWeight, 0);
  const market = mode === "market-coverage";
  const targetTotal = market ? selectedWeight : coveredWeight;
  const referenceTotal = market
    ? acwi.reduce((sum, position) => sum + position.weight, 0)
    : covered.reduce((sum, position) => sum + bySecurity.get(position.securityId)!.weight, 0);
  const canCalculate = targetTotal > 0 && referenceTotal > 0;
  const coverageWeight = selectedWeight > 0 ? coveredWeight / selectedWeight * 100 : 0;
  const rows = selected.map((position): HoldingsAnalysisPosition => {
    const benchmark = bySecurity.get(position.securityId);
    const included = canCalculate && (market || Boolean(benchmark));
    const actualWeight = included ? position.publishedWeight / targetTotal * 100 : null;
    const counterfactualWeight = included ? (benchmark?.weight ?? 0) / referenceTotal * 100 : null;
    const delta = actualWeight !== null && counterfactualWeight !== null ? actualWeight - counterfactualWeight : null;
    return {
      ...position,
      actualWeight: actualWeight === null ? null : round(actualWeight),
      counterfactualWeight: counterfactualWeight === null ? null : round(counterfactualWeight),
      weightDelta: delta === null ? null : round(delta),
      distortionContribution: delta === null ? null : round(Math.abs(delta) / 2),
      distortionStatus: benchmark ? "covered" : "not-in-acwi",
    };
  });
  if (market && canCalculate) {
    const held = new Set(selected.map((position) => position.securityId));
    for (const benchmark of acwi) {
      if (held.has(benchmark.securityId)) continue;
      const weight = benchmark.weight / referenceTotal * 100;
      rows.push({
        securityId: benchmark.securityId, ticker: benchmark.ticker, name: benchmark.name,
        sector: benchmark.sector, assetClass: benchmark.assetClass, country: benchmark.country,
        isCash: false, publishedWeight: 0, normalizedWeightExCash: 0, actualWeight: 0,
        counterfactualWeight: round(weight), weightDelta: round(-weight),
        distortionContribution: round(weight / 2), distortionStatus: "not-held",
      });
    }
  }
  rows.sort((a, b) => (b.distortionContribution ?? -1) - (a.distortionContribution ?? -1) || b.publishedWeight - a.publishedWeight);
  return {
    distortion: {
      ...reference, mode,
      topCount: mode === "top-holdings" ? selected.length : null,
      selectedWeight: round(selectedWeight),
      referenceHoldings: market ? acwi.length : covered.length,
      score: canCalculate ? round(Math.min(100, rows.reduce((sum, position) => sum + (position.distortionContribution ?? 0), 0))) : null,
      coverageWeight: round(coverageWeight),
      coverageStatus: coverageWeight >= 99 ? "complete" : coverageWeight >= 80 ? "partial" : "insufficient",
      coveredHoldings: covered.length, eligibleHoldings: selected.length,
      missingHoldings: selected.length - covered.length,
      methodology: "acwi-free-float-proxy",
    },
    positions: rows,
  };
}
