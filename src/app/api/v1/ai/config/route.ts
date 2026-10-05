import { aiConfiguration } from "@/server/ai-analysis-service";
import { withAiAccess } from "@/server/ai-route";
export const runtime = "nodejs";
export const GET = withAiAccess(async () => Response.json({ data: await aiConfiguration() }, { headers: { "Cache-Control": "private, no-store" } }));
