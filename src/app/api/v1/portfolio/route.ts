import {
  getPortfolio,
  savePortfolio,
} from "@/data/services/portfolio-service";
import type { PortfolioAssetKind } from "@/domain/portfolio";

interface PortfolioRequestItem {
  id: string;
  kind: PortfolioAssetKind;
  referenceId: string;
  allocationWeight: number;
}

export async function GET() {
  const portfolio = await getPortfolio();
  return Response.json(
    { data: portfolio },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      items?: PortfolioRequestItem[];
    };
    if (!Array.isArray(payload.items)) {
      return Response.json(
        { error: "The portfolio items array is required." },
        { status: 400 },
      );
    }

    const portfolio = await savePortfolio(payload.items);
    return Response.json(
      { data: portfolio },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The portfolio could not be saved.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
