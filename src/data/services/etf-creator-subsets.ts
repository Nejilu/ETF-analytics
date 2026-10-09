import "server-only";

import { combineCreatorSubsets, deriveDynamicCreatorHoldings, hasCreatorOverlapMultipliers, type CreatorSubset } from "@/domain/etf-creator";
import type { HoldingsSnapshot } from "@/domain/etf";
import { getHoldingsSnapshot, type RefreshOptions } from "./holdings-service";

export async function resolveCreatorSubsets(subsets: CreatorSubset[], options: RefreshOptions = {}) {
  const ids = new Set<string>();
  for (const subset of subsets) {
    if (subset.allocationWeight <= 0) continue;
    ids.add(subset.sourceEtfId);
    if (hasCreatorOverlapMultipliers(subset.criteria.weightMultipliers) && subset.criteria.overlapEtfId) ids.add(subset.criteria.overlapEtfId);
  }
  const snapshots = await Promise.all([...ids].map((id) => getHoldingsSnapshot(id, options)));
  const byId = new Map(snapshots.map((snapshot) => [snapshot.etf.id, snapshot]));
  const parts = subsets.map((subset) => {
    const source = byId.get(subset.sourceEtfId);
    const overlap = byId.get(subset.criteria.overlapEtfId ?? "");
    const equities = source?.holdings.filter((holding) => holding.assetClass === "Equity") ?? [];
    const sourceById = new Map(equities.map((holding) => [holding.securityId, holding]));
    const derived = deriveDynamicCreatorHoldings(equities, subset.selectedSecurities,
      subset.criteria.weightingMode, subset.criteria.weightMultipliers,
      new Set(overlap?.holdings.map((holding) => holding.securityId) ?? []));
    return {
      ...subset,
      holdings: derived.holdings,
      missingSecurities: subset.allocationWeight > 0 ? derived.missingSecurities : [],
      selectedSecurities: subset.selectedSecurities.map((security) => ({
        securityId: security.securityId, ticker: sourceById.get(security.securityId)?.ticker ?? security.ticker,
      })),
    };
  });
  const result = combineCreatorSubsets(parts);
  const source = byId.get(subsets.find((subset) => subset.allocationWeight > 0)!.sourceEtfId) as HoldingsSnapshot;
  return { ...result, source, snapshots, parts, subsets: parts.map((part) => ({
    id: part.id, name: part.name, allocationWeight: part.allocationWeight, sourceEtfId: part.sourceEtfId,
    criteria: part.criteria, selectedSecurities: part.selectedSecurities,
  })) };
}
