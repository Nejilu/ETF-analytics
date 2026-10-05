import { AiError } from "@/domain/ai-analysis";

// The local branch only serves AI endpoints on loopback. The deployment branch
// replaces this check with signed site owner verification, before any T3 I/O.
export async function requireAiAccess(request: Request): Promise<void> {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) throw new AiError(403, "AI analysis is available locally only.");
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== `${url.protocol}//${host}`) throw new AiError(403, "Invalid request origin.");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AiError(403, "Invalid request origin.");
}
