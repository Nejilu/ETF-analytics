import { createEtfFromAcwi } from "@/data/services/etf-creator-service";
import type { EtfCreatorCriteria } from "@/domain/etf-creator";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      ticker?: string;
      name?: string;
      description?: string;
      selectedSecurityIds?: string[];
      criteria?: EtfCreatorCriteria;
    };
    if (
      typeof payload.ticker !== "string" ||
      typeof payload.name !== "string" ||
      !Array.isArray(payload.selectedSecurityIds) ||
      !payload.criteria
    ) {
      return Response.json(
        { error: "Ticker, ETF name, criteria and holdings are required." },
        { status: 400 },
      );
    }

    const etf = await createEtfFromAcwi({
      ticker: payload.ticker,
      name: payload.name,
      description: payload.description,
      selectedSecurityIds: payload.selectedSecurityIds,
      criteria: payload.criteria,
    });
    return Response.json(
      { data: etf },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The custom ETF could not be saved.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
