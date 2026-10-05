import { AiError } from "@/domain/ai-analysis";
import { loadAiRun } from "@/db/repositories/ai-analysis-repository";
import { aiSnapshot } from "@/server/ai-analysis-service";
import { requireAiAccess } from "@/server/ai-access";
import { withAiAccess } from "@/server/ai-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAiAccess(async (request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  loadAiRun(id); // Reject unknown IDs before opening a stream.
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let finish: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      finish = () => { if (closed) return; closed = true; clearTimeout(timer); request.signal.removeEventListener("abort", finish!); controller.close(); };
      request.signal.addEventListener("abort", finish, { once: true });
      let previous = "";
      const started = Date.now();
      const poll = async () => {
        try {
          // Revalidate signed access during long streams, including JWT expiry.
          await requireAiAccess(request);
          const snapshot = await aiSnapshot(id);
          if (closed) return;
          const data = JSON.stringify(snapshot);
          if (data !== previous) { controller.enqueue(encoder.encode(`event: snapshot\ndata: ${data}\n\n`)); previous = data; }
          else controller.enqueue(encoder.encode(": keepalive\n\n"));
          if (!["starting", "running"].includes(snapshot.state) || Date.now() - started > 240_000) { finish?.(); return; }
          timer = setTimeout(() => void poll(), 1000);
        } catch (error) {
          if (!closed) controller.enqueue(encoder.encode(`event: analysis-error\ndata: ${JSON.stringify({ error: error instanceof AiError ? error.message : "The analysis connection was interrupted. Reopen the conversation to resume." })}\n\n`));
          finish?.();
        }
      };
      if (request.signal.aborted) finish(); else void poll();
    },
    cancel() { closed = true; clearTimeout(timer); if (finish) request.signal.removeEventListener("abort", finish); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
});
