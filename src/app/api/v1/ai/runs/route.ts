import { listAiRuns } from "@/db/repositories/ai-analysis-repository";
import { parseAiRequest } from "@/domain/ai-analysis";
import { startAiAnalysis } from "@/server/ai-analysis-service";
import { readAiBody, withAiAccess } from "@/server/ai-route";
export const runtime = "nodejs";
export const GET = withAiAccess(async () => Response.json({ data: listAiRuns() }, { headers: { "Cache-Control": "private, no-store" } }));
export const POST = withAiAccess(async (request) => Response.json({ data: await startAiAnalysis(parseAiRequest(await readAiBody(request))) }, { status: 201, headers: { "Cache-Control": "private, no-store" } }));
