import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import {
  findEtfById,
  findEtfByTicker,
} from "@/db/repositories/catalog-repository";
import { saveCreatedEtf } from "@/db/repositories/etf-creator-repository";
import type { EtfCreatorCriteria } from "@/domain/etf-creator";
import {
  dynamicCreatorDescription,
  hasCreatorOverlapMultipliers,
  MAX_CREATOR_MULTIPLIER,
  normalizeCreatorHoldings,
  type CreatorWeightMultipliers,
  type CreatorSubset,
} from "@/domain/etf-creator";
import type { EtfShareClass } from "@/domain/etf";

import { getHoldingsSnapshot } from "./holdings-service";
import { resolveCreatorSubsets } from "./etf-creator-subsets";

interface CreateEtfDraft {
  visibility?: import("@/domain/visibility").EtfVisibility;
  ticker: string;
  name: string;
  description?: string;
  sourceEtfId: string;
  selectedSecurityIds: string[];
  criteria: EtfCreatorCriteria;
}

const MAX_SELECTED_SECURITIES = 5_000;

export class EtfCreatorRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtfCreatorRequestError";
  }
}

export class EtfCreatorUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : "The selected ETF source data is unavailable.",
    );
    this.name = "EtfCreatorUnavailableError";
  }
}

export function validatedCreatorCriteria(criteria: EtfCreatorCriteria): EtfCreatorCriteria {
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    throw new EtfCreatorRequestError("Valid selection rules are required for each ETF or subset.");
  }
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    throw new EtfCreatorRequestError("Invalid selection criteria.");
  }
  const countryMode = criteria?.countryMode;
  const sectorMode = criteria?.sectorMode;
  const overlapMode = criteria?.overlapMode;
  const weightingMode = criteria.weightingMode === undefined ? "free-float" : criteria.weightingMode;
  if (weightingMode !== "free-float" && weightingMode !== "equal") {
    throw new EtfCreatorRequestError("Invalid weighting mode.");
  }
  if (countryMode !== "include" && countryMode !== "exclude") {
    throw new EtfCreatorRequestError("Invalid geography filter mode.");
  }
  if (sectorMode !== "include" && sectorMode !== "exclude") {
    throw new EtfCreatorRequestError("Invalid sector filter mode.");
  }
  if (
    overlapMode !== "none" &&
    overlapMode !== "include" &&
    overlapMode !== "exclude"
  ) {
    throw new EtfCreatorRequestError("Invalid overlap filter mode.");
  }
  if (!Array.isArray(criteria.countries) || !Array.isArray(criteria.sectors)) {
    throw new EtfCreatorRequestError("Invalid selection criteria.");
  }
  if (
    criteria.countries.some((value) => typeof value !== "string") ||
    criteria.sectors.some((value) => typeof value !== "string")
  ) {
    throw new EtfCreatorRequestError("Invalid selection criteria.");
  }

  const cleanValues = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 300);

  let weightMultipliers: CreatorWeightMultipliers | undefined;
  if (criteria.weightMultipliers !== undefined) {
    const candidate = criteria.weightMultipliers;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new EtfCreatorRequestError("Invalid weight multipliers.");
    }
    const validateFactor = (value: unknown): number => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_CREATOR_MULTIPLIER) {
        throw new EtfCreatorRequestError(`Weight multipliers must be numbers between 0 and ${MAX_CREATOR_MULTIPLIER}.`);
      }
      return value;
    };
    const validateMap = (value: unknown, limit: number): Record<string, number> | undefined => {
      if (value === undefined) return undefined;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new EtfCreatorRequestError("Invalid weight multiplier group.");
      }
      const entries = Object.entries(value);
      if (entries.length > limit || entries.some(([key]) => !key.trim() || key !== key.trim())) {
        throw new EtfCreatorRequestError("Invalid weight multiplier entries.");
      }
      return Object.fromEntries(entries.map(([key, factor]) => [key, validateFactor(factor)]));
    };
    weightMultipliers = {
      countries: validateMap(candidate.countries, 300),
      sectors: validateMap(candidate.sectors, 300),
      securities: validateMap(candidate.securities, MAX_SELECTED_SECURITIES),
      overlap: candidate.overlap === undefined ? undefined : validateFactor(candidate.overlap),
      nonOverlap: candidate.nonOverlap === undefined ? undefined : validateFactor(candidate.nonOverlap),
    };
  }
  const needsOverlapReference = overlapMode !== "none" || hasCreatorOverlapMultipliers(weightMultipliers);
  if (criteria.overlapEtfId !== undefined && typeof criteria.overlapEtfId !== "string") {
    throw new EtfCreatorRequestError("Invalid overlap ETF reference.");
  }
  const overlapEtfId = needsOverlapReference ? criteria.overlapEtfId?.trim() : undefined;
  if (needsOverlapReference && !overlapEtfId) {
    throw new EtfCreatorRequestError("Select a reference ETF for overlap rules or multipliers.");
  }

  let subsets: CreatorSubset[] | undefined;
  if (criteria.subsets !== undefined) {
    if (!Array.isArray(criteria.subsets) || criteria.subsets.length === 0) {
      throw new EtfCreatorRequestError("Add at least one allocated subset.");
    }
    const ids = new Set<string>();
    subsets = criteria.subsets.map((subset) => {
      if (!subset || typeof subset !== "object" || typeof subset.id !== "string" || !subset.id.trim() || subset.id.length > 100 || ids.has(subset.id)) {
        throw new EtfCreatorRequestError("Each subset needs a unique identifier.");
      }
      ids.add(subset.id);
      if (typeof subset.name !== "string" || !subset.name.trim() || subset.name.length > 80 || typeof subset.sourceEtfId !== "string" || !subset.sourceEtfId.trim()) {
        throw new EtfCreatorRequestError("Each subset needs a name and a source ETF.");
      }
      if (typeof subset.allocationWeight !== "number" || !Number.isFinite(subset.allocationWeight) || subset.allocationWeight < 0 || subset.allocationWeight > 100) {
        throw new EtfCreatorRequestError("Subset allocations must be percentages between 0 and 100.");
      }
      if (!Array.isArray(subset.selectedSecurities) || subset.selectedSecurities.length > MAX_SELECTED_SECURITIES || subset.selectedSecurities.some((security) => !security || typeof security.securityId !== "string" || !security.securityId.trim() || typeof security.ticker !== "string")) {
        throw new EtfCreatorRequestError("Invalid subset constituent selection.");
      }
      if (subset.criteria?.subsets !== undefined) throw new EtfCreatorRequestError("Nested subsets are not supported.");
      return {
        id: subset.id, name: subset.name.trim(), allocationWeight: subset.allocationWeight,
        sourceEtfId: subset.sourceEtfId.trim(), criteria: validatedCreatorCriteria(subset.criteria),
        selectedSecurities: [...new Map(subset.selectedSecurities.map((security) => [security.securityId.trim(), { securityId: security.securityId.trim(), ticker: security.ticker.trim() || "—" }])).values()],
      };
    });
    if (Math.abs(subsets.reduce((sum, subset) => sum + subset.allocationWeight, 0) - 100) > 1e-6) {
      throw new EtfCreatorRequestError("Subset allocations must total 100% before saving.");
    }
  }

  return {
    subsets,
    weightingMode,
    weightMultipliers,
    countryMode,
    countries: cleanValues(criteria.countries),
    sectorMode,
    sectors: cleanValues(criteria.sectors),
    overlapMode,
    overlapEtfId,
  };
}

export async function createEtfFromSource(
  draft: CreateEtfDraft,
): Promise<EtfShareClass> {
  try {
    ensureLocalDatabase();
    if (!draft || typeof draft !== "object") {
      throw new EtfCreatorRequestError("ETF creator data is required.");
    }
    if (
      typeof draft.ticker !== "string" ||
      typeof draft.name !== "string" ||
      typeof draft.sourceEtfId !== "string" ||
      (draft.description !== undefined && typeof draft.description !== "string") ||
      !Array.isArray(draft.selectedSecurityIds) ||
      draft.selectedSecurityIds.some((id) => typeof id !== "string")
    ) {
      throw new EtfCreatorRequestError("Ticker, base ETF, name and holdings must be valid.");
    }
    const ticker = draft.ticker.trim().toUpperCase();
    const name = draft.name.trim();
    const sourceEtfId = draft.sourceEtfId.trim();
    const customDescription = draft.description?.trim();

    if (!/^[A-Z][A-Z0-9.-]{1,9}$/.test(ticker)) {
      throw new EtfCreatorRequestError("Use a ticker of 2 to 10 letters, numbers, dots or hyphens.");
    }
    if (name.length < 3 || name.length > 80) {
      throw new EtfCreatorRequestError("The ETF name must contain between 3 and 80 characters.");
    }
    if (customDescription && customDescription.length > 240) {
      throw new EtfCreatorRequestError("The description cannot exceed 240 characters.");
    }
    if (!sourceEtfId) {
      throw new EtfCreatorRequestError("Select a base ETF before saving.");
    }
    if (findEtfByTicker(ticker)) {
      throw new EtfCreatorRequestError(`Ticker ${ticker} is already used.`);
    }

    const criteria = validatedCreatorCriteria(draft.criteria);
    if (criteria.subsets) {
      const resolved = await resolveCreatorSubsets(criteria.subsets);
      if (resolved.parts.some((part) => part.missingSecurities.length > 0)) throw new EtfCreatorRequestError("A subset contains securities unavailable in its source ETF. Review its selection.");
      if (resolved.emptySubsetNames.length) throw new EtfCreatorRequestError(`Keep a positive weight in each allocated subset: ${resolved.emptySubsetNames.join(", ")}.`);
      criteria.subsets = resolved.subsets;
      return saveCreatedEtf({
        visibility: draft.visibility, ticker, name, source: resolved.source,
        selectedHoldings: resolved.holdings, criteria, editableDescription: customDescription ?? "",
        description: dynamicCreatorDescription(customDescription ?? "", resolved.holdings.length, resolved.source.etf.ticker, undefined, undefined, criteria.subsets),
      });
    }

    const sourceEtf = findEtfById(sourceEtfId);
    if (!sourceEtf) {
      throw new EtfCreatorRequestError("The selected base ETF is no longer available.");
    }

    const selectedSecurityIds = [
      ...new Set(draft.selectedSecurityIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (selectedSecurityIds.length === 0) {
      throw new EtfCreatorRequestError("Keep at least one source ETF security before saving the ETF.");
    }
    if (selectedSecurityIds.length > MAX_SELECTED_SECURITIES) {
      throw new EtfCreatorRequestError(`An ETF can contain up to ${MAX_SELECTED_SECURITIES} securities.`);
    }

    const source = await getHoldingsSnapshot(sourceEtf.id);
    const sourceEquities = source.holdings.filter(
      (holding) => holding.assetClass === "Equity",
    );
    const selectedSet = new Set(selectedSecurityIds);
    const selected = sourceEquities.filter((holding) =>
      selectedSet.has(holding.securityId),
    );
    if (selected.length !== selectedSecurityIds.length) {
      throw new EtfCreatorRequestError(
        "The source ETF universe changed while the selection was open. Review the selection and try again.",
      );
    }

    const overlap = hasCreatorOverlapMultipliers(criteria.weightMultipliers)
      ? await getHoldingsSnapshot(criteria.overlapEtfId!)
      : null;
    const normalized = normalizeCreatorHoldings(
      selected, criteria.weightingMode, criteria.weightMultipliers,
      new Set(overlap?.holdings.map((holding) => holding.securityId) ?? []),
    );
    if (normalized.length === 0) {
      throw new EtfCreatorRequestError("The selected weighting and multipliers must leave at least one positive weight.");
    }
    const description = dynamicCreatorDescription(
      customDescription ?? "",
      normalized.length,
      source.etf.ticker,
      criteria.weightingMode,
      criteria.weightMultipliers,
    );

    return saveCreatedEtf({
      visibility: draft.visibility,
      ticker,
      name,
      description,
      source,
      selectedHoldings: normalized,
      criteria,
      editableDescription: customDescription ?? "",
    });
  } catch (error) {
    if (error instanceof EtfCreatorRequestError) throw error;
    if (error instanceof EtfCreatorUnavailableError) throw error;
    throw new EtfCreatorUnavailableError(error);
  }
}

export const createEtfFromAcwi = createEtfFromSource;
