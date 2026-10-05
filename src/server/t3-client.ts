import "server-only";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import { AiError, type AiModel } from "@/domain/ai-analysis";

interface T3Provider {
  instanceId: string; driver: string; displayName: string; enabled: boolean;
  status: string; auth: { status: string };
  models: { slug: string; name: string; isDefault?: boolean; capabilities?: {
    optionDescriptors?: { id: string; currentValue?: string; options?: { id: string; label: string; isDefault?: boolean }[] }[];
  } }[];
}
export interface T3Config {
  providers: T3Provider[];
  settings: { providerInstances: Record<string, { config?: { launchArgs?: string } }> };
}
export interface T3Thread {
  id: string;
  messages: { id: string; role: string; text: string }[];
  latestTurn: { state: "running" | "completed" | "interrupted" | "error"; requestedAt: string } | null;
  session: { status: string; lastError: string | null } | null;
  activities: { kind: string; summary: string; payload: Record<string, unknown> }[];
}

export function t3Connection() {
  const configured = process.env.T3_BASE_URL?.trim();
  const tokenFile = process.env.T3_AUTH_TOKEN_FILE?.trim();
  if (!configured || !tokenFile) throw new AiError(503, "Connect T3 in the server configuration to enable analysis. See docs/ai-analysis.md.");
  let url: URL;
  try { url = new URL(configured); } catch { throw new AiError(503, "Invalid T3 connection configuration."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new AiError(503, "Invalid T3 connection configuration.");
  return { url, tokenFile, instanceId: process.env.T3_PROVIDER_INSTANCE?.trim() || "weightings-analysis", projectId: process.env.T3_PROJECT_ID?.trim() || "weightings-analysis" };
}

export class T3Client {
  constructor(private base: URL, private token: string) {}

  static async configured() {
    const config = t3Connection();
    let token: string;
    try { token = (await readFile(config.tokenFile, "utf8")).trim(); } catch { throw new AiError(503, "The T3 backend credential file is unavailable."); }
    if (!token || token.length > 16_000) throw new AiError(503, "Invalid T3 backend credential.");
    const client = new T3Client(config.url, token);
    const descriptor = await client.http<{ serverVersion: string; orchestrationProtocolVersion: number; environmentId: string }>("/.well-known/t3/environment", undefined, false);
    if (descriptor.orchestrationProtocolVersion !== 1) throw new AiError(503, "This T3 protocol version is not supported. Update the analysis connector.");
    return { client, ...config, descriptor };
  }

  async http<T>(path: string, body?: unknown, authenticated = true): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.base), {
        method: body === undefined ? "GET" : "POST",
        headers: { ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new AiError(503, "T3 is unreachable. Check the backend connection."); }
    if (!response.ok) throw new AiError(response.status === 404 ? 404 : 503, response.status === 401 || response.status === 403 ? "The T3 backend session has expired or lacks permission. Renew it on the T3 host." : "T3 could not process the analysis request.");
    try { return await response.json() as T; } catch { throw new AiError(503, "Unexpected response from T3."); }
  }

  // T3 0.0.45 exposes commands/snapshots over HTTP; provider discovery remains
  // an Effect RPC call. Keep the wire protocol confined to this adapter.
  async rpc<T>(tag: string, payload: unknown): Promise<T> {
    const { ticket } = await this.http<{ ticket: string }>("/api/auth/websocket-ticket", {});
    const url = new URL("/ws", this.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("wsTicket", ticket);
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: 8_000_000 });
      let settled = false;
      const finish = (value?: T, failed = false) => {
        if (settled) return;
        settled = true; clearTimeout(timer); socket.close();
        if (failed) reject(new AiError(503, "T3 provider discovery failed. Check its status and backend permissions.")); else resolve(value as T);
      };
      const timer = setTimeout(() => { finish(undefined, true); socket.terminate(); }, 15_000);
      socket.on("open", () => socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })));
      socket.on("message", (data) => {
        try {
          const frames = JSON.parse(data.toString());
          for (const frame of Array.isArray(frames) ? frames : [frames]) {
            if (frame._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
            if (frame._tag === "Exit" && frame.requestId === "1") finish(frame.exit.value as T, frame.exit._tag !== "Success");
          }
        } catch { finish(undefined, true); }
      });
      socket.on("error", () => finish(undefined, true));
      socket.on("close", () => finish(undefined, true));
    });
  }

  dispatch(command: Record<string, unknown>) { return this.http<{ sequence: number }>("/api/orchestration/dispatch", command); }
  thread(id: string) { return this.http<{ thread: T3Thread }>(`/api/orchestration/threads/${encodeURIComponent(id)}?turnLimit=12`); }
}

export function analysisModels(config: T3Config, instanceId: string): { models: AiModel[]; providerName: string } {
  const provider = config.providers.find((p) => p.instanceId === instanceId);
  if (!provider || provider.driver !== "codex" || !provider.enabled || provider.status !== "ready" || provider.auth.status !== "authenticated") throw new AiError(503, "The analysis Codex instance is not ready in T3. Run the connection setup on the T3 host.");
  const args = config.settings.providerInstances[instanceId]?.config?.launchArgs ?? "";
  if (!/web_search\s*=\s*["']?live\b/.test(args)) throw new AiError(503, "Live web search is not enabled for this Codex instance. Run the connection setup on the T3 host.");
  const models = provider.models.map((model) => {
    const reasoning = model.capabilities?.optionDescriptors?.find((option) => option.id === "reasoningEffort");
    const efforts = reasoning?.options?.map(({ id, label }) => ({ id, label })) ?? [];
    return { id: model.slug, name: model.name, isDefault: model.isDefault === true, efforts, defaultEffort: reasoning?.options?.find((v) => v.isDefault)?.id ?? reasoning?.currentValue ?? efforts[0]?.id ?? "" };
  });
  if (!models.length) throw new AiError(503, "T3 returned no available Codex models.");
  return { models, providerName: provider.displayName };
}
