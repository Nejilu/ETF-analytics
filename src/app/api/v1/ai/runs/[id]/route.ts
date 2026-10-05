import { aiSnapshot, interruptAiAnalysis } from "@/server/ai-analysis-service";
import { withAiAccess } from "@/server/ai-route";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = withAiAccess(async (_request, context: Context) => Response.json({ data: await aiSnapshot((await context.params).id) }, { headers: { "Cache-Control": "private, no-store" } }));
export const DELETE = withAiAccess(async (_request, context: Context) => { await interruptAiAnalysis((await context.params).id); return Response.json({ stopped: true }, { headers: { "Cache-Control": "private, no-store" } }); });
