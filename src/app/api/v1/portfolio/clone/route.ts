import { withSiteAccess } from "@/server/site-route";
import { clonePortfolio } from "@/data/services/portfolio-clone-service";
import { PortfolioCloneRequestError, type PortfolioCloneDraft } from "@/domain/portfolio-clone";
import { PortfolioRequestError } from "@/data/services/portfolio-service";

export const POST = withSiteAccess(async (request: Request) => {
  try {
    const draft = await request.json() as PortfolioCloneDraft;
    return Response.json({ data: await clonePortfolio(draft) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof PortfolioCloneRequestError || error instanceof PortfolioRequestError;
    return Response.json({ error: error instanceof SyntaxError ? "Request body must be valid JSON." : error instanceof Error ? error.message : "The allocation could not be cloned." }, { status: invalid ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  }
}, "owner");
