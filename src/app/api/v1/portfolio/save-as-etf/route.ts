import { savePortfolioAsEtf } from "@/data/services/portfolio-service";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      ticker?: string;
      name?: string;
      description?: string;
    };
    if (typeof payload.ticker !== "string" || typeof payload.name !== "string") {
      return Response.json(
        { error: "Ticker and ETF name are required." },
        { status: 400 },
      );
    }

    const etf = savePortfolioAsEtf({
      ticker: payload.ticker,
      name: payload.name,
      description: payload.description,
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
            : "The portfolio ETF could not be saved.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
