import { getPortfolioHistory, updatePortfolioHistory } from "@/data/services/portfolio-history-service";
import { PortfolioRequestError } from "@/data/services/portfolio-service";
import { withSiteAccess } from "@/server/site-route";

const headers = { "Cache-Control": "no-store" };
function portfolioId(request: Request) {
  const id = new URL(request.url).searchParams.get("portfolioId");
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new PortfolioRequestError("A valid portfolio ID is required.");
  return id;
}
function failure(error: unknown) {
  const status = error instanceof PortfolioRequestError || error instanceof SyntaxError ? 400 : 503;
  return Response.json({ error: status === 400 && error instanceof Error ? error.message : "Portfolio history is temporarily unavailable." }, { status, headers });
}

export const GET = withSiteAccess(async (request: Request) => {
  try {
    return Response.json({ data: await getPortfolioHistory(portfolioId(request)) }, { headers });
  } catch (error) { return failure(error); }
}, "owner");

export const PATCH = withSiteAccess(async (request: Request) => {
  try {
    const id = portfolioId(request);
    const payload = await request.json();
    if (!payload || typeof payload.enabled !== "boolean") throw new PortfolioRequestError("Enabled must be a boolean.");
    return Response.json({ data: await updatePortfolioHistory(id, payload.enabled) }, { headers });
  } catch (error) { return failure(error); }
}, "owner");
