import { AiError } from "@/domain/ai-analysis";
import { AccessError, getSiteAccess, requireOwner } from "./site-access";

export async function requireAiAccess(request: Request): Promise<void> {
  try {
    requireOwner(await getSiteAccess(request.headers), request);
  } catch (error) {
    if (error instanceof AccessError) throw new AiError(error.status, error.message);
    throw new AiError(403, "Owner access required.");
  }
}
