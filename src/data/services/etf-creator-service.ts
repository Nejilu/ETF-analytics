import "server-only";

import { ensureLocalDatabase } from "@/db/bootstrap";
import {
  findEtfByTicker,
} from "@/db/repositories/catalog-repository";
import { saveCreatedEtf } from "@/db/repositories/etf-creator-repository";
import type { EtfCreatorCriteria } from "@/domain/etf-creator";
import { normalizeCreatorHoldings } from "@/domain/etf-creator";
import type { EtfShareClass } from "@/domain/etf";

import { getHoldingsSnapshot } from "./holdings-service";

interface CreateEtfDraft {
  ticker: string;
  name: string;
  description?: string;
  selectedSecurityIds: string[];
  criteria: EtfCreatorCriteria;
}

const MAX_SELECTED_SECURITIES = 5_000;

function validatedCriteria(criteria: EtfCreatorCriteria): EtfCreatorCriteria {
  const countryMode = criteria?.countryMode;
  const sectorMode = criteria?.sectorMode;
  const overlapMode = criteria?.overlapMode;
  if (countryMode !== "include" && countryMode !== "exclude") {
    throw new Error("Invalid geography filter mode.");
  }
  if (sectorMode !== "include" && sectorMode !== "exclude") {
    throw new Error("Invalid sector filter mode.");
  }
  if (
    overlapMode !== "none" &&
    overlapMode !== "include" &&
    overlapMode !== "exclude"
  ) {
    throw new Error("Invalid overlap filter mode.");
  }
  if (!Array.isArray(criteria.countries) || !Array.isArray(criteria.sectors)) {
    throw new Error("Invalid selection criteria.");
  }

  const cleanValues = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 300);

  return {
    countryMode,
    countries: cleanValues(criteria.countries),
    sectorMode,
    sectors: cleanValues(criteria.sectors),
    overlapMode,
    overlapEtfId:
      overlapMode === "none" ? undefined : criteria.overlapEtfId?.trim(),
  };
}

export async function createEtfFromAcwi(
  draft: CreateEtfDraft,
): Promise<EtfShareClass> {
  ensureLocalDatabase();
  const ticker = draft.ticker.trim().toUpperCase();
  const name = draft.name.trim();
  const customDescription = draft.description?.trim();

  if (!/^[A-Z][A-Z0-9.-]{1,9}$/.test(ticker)) {
    throw new Error("Use a ticker of 2 to 10 letters, numbers, dots or hyphens.");
  }
  if (name.length < 3 || name.length > 80) {
    throw new Error("The ETF name must contain between 3 and 80 characters.");
  }
  if (customDescription && customDescription.length > 240) {
    throw new Error("The description cannot exceed 240 characters.");
  }
  if (findEtfByTicker(ticker)) {
    throw new Error(`Ticker ${ticker} is already used.`);
  }
  if (!Array.isArray(draft.selectedSecurityIds)) {
    throw new Error("A manual security selection is required.");
  }

  const selectedSecurityIds = [
    ...new Set(draft.selectedSecurityIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (selectedSecurityIds.length === 0) {
    throw new Error("Keep at least one ACWI security before saving the ETF.");
  }
  if (selectedSecurityIds.length > MAX_SELECTED_SECURITIES) {
    throw new Error(`An ETF can contain up to ${MAX_SELECTED_SECURITIES} securities.`);
  }

  const criteria = validatedCriteria(draft.criteria);
  const source = await getHoldingsSnapshot("ACWI");
  const sourceEquities = source.holdings.filter(
    (holding) => holding.assetClass === "Equity",
  );
  const selectedSet = new Set(selectedSecurityIds);
  const selected = sourceEquities.filter((holding) =>
    selectedSet.has(holding.securityId),
  );
  if (selected.length !== selectedSecurityIds.length) {
    throw new Error(
      "The ACWI universe changed while the selection was open. Review the selection and try again.",
    );
  }

  const normalized = normalizeCreatorHoldings(selected);
  if (normalized.length === 0) {
    throw new Error("The retained ACWI securities have no usable free-float weight.");
  }
  const description = [
    customDescription,
    `${normalized.length} ACWI constituents, frozen and normalized to 100% from ACWI free-float weights as of ${source.asOf}.`,
    "The saved definition keeps these securities and weights unchanged.",
  ]
    .filter(Boolean)
    .join(" ");

  return saveCreatedEtf({
    ticker,
    name,
    description,
    source,
    selectedHoldings: normalized,
    criteria,
  });
}
