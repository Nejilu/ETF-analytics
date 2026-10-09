import type { Holding } from "./etf";

export type CreatorFilterMode = "include" | "exclude";
export type CreatorOverlapMode = "none" | "include" | "exclude";
export type CreatorWeightingMode = "free-float" | "equal";
export const MAX_CREATOR_MULTIPLIER = 1_000;

export interface CreatorWeightMultipliers {
  countries?: Record<string, number>;
  sectors?: Record<string, number>;
  securities?: Record<string, number>;
  overlap?: number;
  nonOverlap?: number;
}

export function hasCreatorOverlapMultipliers(multipliers?: CreatorWeightMultipliers): boolean {
  return (multipliers?.overlap ?? 1) !== 1 || (multipliers?.nonOverlap ?? 1) !== 1;
}

export function hasCreatorWeightMultipliers(multipliers?: CreatorWeightMultipliers): boolean {
  return hasCreatorOverlapMultipliers(multipliers) ||
    [multipliers?.countries, multipliers?.sectors, multipliers?.securities]
      .some((values) => Object.values(values ?? {}).some((factor) => factor !== 1));
}

export function creatorHoldingMultiplier(
  holding: Holding,
  multipliers?: CreatorWeightMultipliers,
  overlapSecurityIds: ReadonlySet<string> = new Set(),
): number {
  const factorFor = (values: Record<string, number> | undefined, key: string) =>
    values && Object.hasOwn(values, key) ? values[key] : 1;
  return factorFor(multipliers?.countries, holding.country) *
    factorFor(multipliers?.sectors, holding.sector) *
    factorFor(multipliers?.securities, holding.securityId) *
    (overlapSecurityIds.has(holding.securityId)
      ? multipliers?.overlap ?? 1
      : multipliers?.nonOverlap ?? 1);
}

export function creatorCompositionModel(
  weightingMode: CreatorWeightingMode = "free-float",
  multipliers?: CreatorWeightMultipliers,
) {
  if (hasCreatorWeightMultipliers(multipliers)) {
    return weightingMode === "equal"
      ? "dynamic-source-adjusted-equal"
      : "dynamic-source-adjusted-free-float";
  }
  return weightingMode === "equal"
    ? "dynamic-source-equal"
    : "dynamic-source-free-float";
}

export interface EtfCreatorCriteria {
  subsets?: CreatorSubset[];
  weightingMode?: CreatorWeightingMode;
  weightMultipliers?: CreatorWeightMultipliers;
  countryMode: CreatorFilterMode;
  countries: string[];
  sectorMode: CreatorFilterMode;
  sectors: string[];
  overlapMode: CreatorOverlapMode;
  overlapEtfId?: string;
}

export interface CreatorSubset {
  id: string;
  name: string;
  allocationWeight: number;
  sourceEtfId: string;
  criteria: EtfCreatorCriteria;
  selectedSecurities: CreatorSelectedSecurity[];
}

export function defaultCreatorCriteria(): EtfCreatorCriteria {
  return { weightingMode: "free-float", countryMode: "include", countries: [], sectorMode: "include", sectors: [], overlapMode: "none" };
}

export function creatorCriteriaCompositionModel(criteria?: EtfCreatorCriteria): string {
  return criteria?.subsets?.length
    ? "dynamic-source-subsets"
    : creatorCompositionModel(criteria?.weightingMode, criteria?.weightMultipliers);
}

export function combineCreatorSubsets(
  subsets: { id: string; name: string; allocationWeight: number; holdings: Holding[] }[],
): { holdings: Holding[]; allocationTotal: number; emptySubsetNames: string[] } {
  const combined = new Map<string, Holding>();
  const emptySubsetNames: string[] = [];
  let allocationTotal = 0;
  for (const subset of subsets) {
    allocationTotal += subset.allocationWeight;
    if (subset.allocationWeight <= 0) continue;
    if (!subset.holdings.some((holding) => holding.weight > 0)) {
      emptySubsetNames.push(subset.name);
      continue;
    }
    for (const holding of subset.holdings) {
      const contribution = holding.weight * subset.allocationWeight / 100;
      const existing = combined.get(holding.securityId);
      combined.set(holding.securityId, { ...holding, marketValue: undefined, weight: (existing?.weight ?? 0) + contribution });
    }
  }
  const holdings = [...combined.values()].sort((a, b) => b.weight - a.weight);
  if (holdings.length && emptySubsetNames.length === 0) {
    const total = holdings.reduce((sum, holding) => sum + holding.weight, 0);
    holdings[0] = { ...holdings[0], weight: holdings[0].weight + allocationTotal - total };
  }
  return { holdings, allocationTotal, emptySubsetNames };
}

export interface CreatorSelectedSecurity {
  securityId: string;
  ticker: string;
}

interface DynamicCreatorHoldings {
  holdings: Holding[];
  missingSecurities: CreatorSelectedSecurity[];
}

export function filterCreatorHoldings(
  holdings: Holding[],
  criteria: EtfCreatorCriteria,
  overlapSecurityIds: ReadonlySet<string> = new Set(),
): Holding[] {
  const countries = new Set(criteria.countries);
  const sectors = new Set(criteria.sectors);

  return holdings.filter((holding) => {
    if (countries.size > 0) {
      const countryMatches = countries.has(holding.country);
      if (
        (criteria.countryMode === "include" && !countryMatches) ||
        (criteria.countryMode === "exclude" && countryMatches)
      ) return false;
    }

    if (sectors.size > 0) {
      const sectorMatches = sectors.has(holding.sector);
      if (
        (criteria.sectorMode === "include" && !sectorMatches) ||
        (criteria.sectorMode === "exclude" && sectorMatches)
      ) return false;
    }

    if (criteria.overlapMode !== "none") {
      const overlaps = overlapSecurityIds.has(holding.securityId);
      if (criteria.overlapMode === "include" && !overlaps) return false;
      if (criteria.overlapMode === "exclude" && overlaps) return false;
    }

    return true;
  });
}

export function applyCreatorManualCuration(
  sourceHoldings: Holding[],
  automaticHoldings: Holding[],
  manualInclusions: ReadonlySet<string> = new Set(),
  manualExclusions: ReadonlySet<string> = new Set(),
): Holding[] {
  const automaticIds = new Set(
    automaticHoldings.map((holding) => holding.securityId),
  );

  return sourceHoldings.filter(
    (holding) =>
      (automaticIds.has(holding.securityId) ||
        manualInclusions.has(holding.securityId)) &&
      !manualExclusions.has(holding.securityId),
  );
}

export function normalizeCreatorHoldings(
  holdings: Holding[],
  weightingMode: CreatorWeightingMode = "free-float",
  multipliers?: CreatorWeightMultipliers,
  overlapSecurityIds: ReadonlySet<string> = new Set(),
): Holding[] {
  const baseWeight = (holding: Holding) =>
    (weightingMode === "equal" ? 1 : Math.max(0, holding.weight)) *
    creatorHoldingMultiplier(holding, multipliers, overlapSecurityIds);
  const total = holdings.reduce(
    (sum, holding) => sum + baseWeight(holding),
    0,
  );
  if (total <= 0) return [];

  const normalized = holdings
    .map((holding) => ({
      ...holding,
      weight: (baseWeight(holding) / total) * 100,
      marketValue: undefined,
    }))
    .sort((left, right) => right.weight - left.weight);
  const normalizedTotal = normalized.reduce(
    (sum, holding) => sum + holding.weight,
    0,
  );
  if (normalized.length > 0) {
    normalized[0] = {
      ...normalized[0],
      weight: normalized[0].weight + (100 - normalizedTotal),
    };
  }
  return normalized;
}

export function deriveDynamicCreatorHoldings(
  sourceHoldings: Holding[],
  selectedSecurities: CreatorSelectedSecurity[],
  weightingMode: CreatorWeightingMode = "free-float",
  multipliers?: CreatorWeightMultipliers,
  overlapSecurityIds: ReadonlySet<string> = new Set(),
): DynamicCreatorHoldings {
  const sourceBySecurityId = new Map(
    sourceHoldings.map((holding) => [holding.securityId, holding]),
  );
  const uniqueSelection = selectedSecurities.filter(
    (security, index) =>
      security.securityId.trim() &&
      selectedSecurities.findIndex(
        (candidate) => candidate.securityId === security.securityId,
      ) === index,
  );
  const missingSecurities = uniqueSelection.filter(
    (security) => !sourceBySecurityId.has(security.securityId),
  );
  const holdings = normalizeCreatorHoldings(
    uniqueSelection.flatMap((security) => {
      const holding = sourceBySecurityId.get(security.securityId);
      return holding ? [holding] : [];
    }),
    weightingMode,
    multipliers,
    overlapSecurityIds,
  );

  return { holdings, missingSecurities };
}

export function dynamicCreatorDescription(
  editableDescription: string,
  selectedCount: number,
  sourceTicker: string,
  weightingMode: CreatorWeightingMode = "free-float",
  multipliers?: CreatorWeightMultipliers,
  subsets?: CreatorSubset[],
): string {
  return [
    editableDescription.trim(),
    subsets?.length
      ? `${selectedCount} constituents across ${subsets.length} allocated subsets (${subsets.map((subset) => `${subset.name}: ${subset.allocationWeight}%`).join(", ")}); each subset follows its own selection and weighting rules, and shared securities are combined on every read.`
      : hasCreatorWeightMultipliers(multipliers)
      ? `${selectedCount} ${sourceTicker} constituents selected; custom country, sector, overlap and security multipliers are applied to ${weightingMode === "equal" ? "equal base" : "source free-float"} weights, then normalized to 100% on every read.`
      : weightingMode === "equal"
      ? `${selectedCount} ${sourceTicker} constituents selected; available constituents are equally weighted to a total of 100% on every read.`
      : `${selectedCount} ${sourceTicker} constituents selected; available source free-float weights are recalculated and normalized to 100% on every read.`,
  ]
    .filter(Boolean)
    .join(" ");
}
