"use client";

import { useEffect, useSyncExternalStore } from "react";
import { adrPairForListing, type AdrListingDescriptor, type AdrPairId } from "@/domain/adr-premium";
import { adrPremiumStore } from "./adr-premium-store";

const date = (value: string, includeTime = false) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "2-digit", month: "short",
  ...(includeTime ? { year: "numeric", hour: "2-digit", minute: "2-digit" } as const : {}),
}).format(new Date(value));

function SupportedAdrPremiumBadge({ pairId }: { pairId: AdrPairId }) {
  const snapshot = useSyncExternalStore(adrPremiumStore.subscribe, adrPremiumStore.getSnapshot, adrPremiumStore.getServerSnapshot);
  useEffect(() => {
    void adrPremiumStore.load();
  }, []);
  const view = snapshot.data[pairId];
  const observation = view?.observation;
  const ticker = pairId === "tsmc" ? "TSM" : "SKHY";
  const number = observation ? `${observation.premiumPct >= 0 ? "+" : ""}${observation.premiumPct.toFixed(2)}%` : snapshot.status === "idle" || snapshot.status === "loading" ? "…" : "—";
  const stale = view?.sourceStatus === "stale";
  const closing = observation?.mode === "closing-prices";
  const title = observation
    ? `${ticker} ADR premium ${number}. ${closing ? "Latest closing prices at different times" : "Synchronized comparison at the last available Asian close"}. Asian close: ${date(observation.localCloseAt, true)} UTC. US price: ${date(observation.adrPriceAt, true)} UTC. FX: ${date(observation.fxAt, true)} UTC. Last successful retrieval: ${date(view.capturedAt, true)} UTC.${stale ? " Refresh failed; previously captured comparison." : ""} Applies to the ADR component of this line.`
    : `${ticker} ADR premium ${number === "…" ? "loading" : "unavailable"}.`;
  return <span className={`adr-premium-badge${stale ? " adr-premium-badge--stale" : ""}`} tabIndex={0} role="note" aria-label={title} title={title}>
    <span className="adr-premium-badge__symbol">{ticker}</span> ADR {number}{observation ? <><span className="adr-premium-badge__date"> · {closing ? "closes" : "sync"} {date(closing ? observation.adrPriceAt : observation.localCloseAt)}</span>{stale ? " · stale" : ""}</> : null}
  </span>;
}

export function AdrPremiumBadge({ security }: { security: AdrListingDescriptor }) {
  const pair = adrPairForListing(security);
  return pair ? <SupportedAdrPremiumBadge pairId={pair.id} /> : null;
}
