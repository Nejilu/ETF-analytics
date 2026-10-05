import { AiError } from "@/domain/ai-analysis";
import { requireAiAccess } from "./ai-access";

export function withAiAccess<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      await requireAiAccess(request);
      return await handler(request, ...args);
    } catch (error) {
      return Response.json({ error: error instanceof AiError ? error.message : "AI analysis is temporarily unavailable." }, {
        status: error instanceof AiError ? error.status : error instanceof SyntaxError ? 400 : 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  };
}

export async function readAiBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AiError(400, "Missing request body.");
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16_000) { await reader.cancel(); throw new AiError(413, "Analysis request too large."); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
