import {
  PortfolioRequestError,
  PortfolioUnavailableError,
  savePortfolioAsEtf,
} from "@/data/services/portfolio-service";

function errorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof PortfolioRequestError) {
    return Response.json(
      { error: error.message },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof PortfolioUnavailableError) {
    return Response.json(
      { error: error.message || "Portfolio data is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: "The portfolio ETF could not be saved." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      ticker?: string;
      name?: string;
      description?: string;
    };
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.ticker !== "string" ||
      typeof payload.name !== "string" ||
      (payload.description !== undefined && typeof payload.description !== "string")
    ) {
      return Response.json(
        { error: "Ticker and ETF name are required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const etf = await savePortfolioAsEtf({
      ticker: payload.ticker,
      name: payload.name,
      description: payload.description,
    });
    return Response.json(
      { data: etf },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
