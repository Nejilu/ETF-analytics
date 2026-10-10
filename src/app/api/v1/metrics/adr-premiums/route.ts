import { ADR_PAIRS, type AdrPairId, type AdrPremiumView } from "@/domain/adr-premium";
import { getAdrPremium } from "@/data/services/adr-premium-service";
import { withSiteAccess } from "@/server/site-route";

async function handleGET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";
  // Only the two fixed public instruments are accepted; portfolio data is not needed.
  const entries = await Promise.all(ADR_PAIRS.map(async (pair) => {
    const view = await getAdrPremium({
      securityId: pair.id, ticker: pair.adrSymbol.split(":")[1],
      name: pair.id === "tsmc" ? "Taiwan Semiconductor ADR" : "SK Hynix ADR",
    }, refresh);
    return [pair.id, view] as const;
  }));
  return Response.json({ data: Object.fromEntries(entries) as Record<AdrPairId, AdrPremiumView | null> });
}

export const GET = withSiteAccess(handleGET, "read");
