import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { AI_TEMPLATES, AiError, parseAiRequest } from "@/domain/ai-analysis";
import { T3Client, analysisModels, type T3Config, type T3Thread } from "./t3-client";
import { analysisPrompt, positionContext } from "./ai-context";
import { startAiAnalysis, aiSnapshot, interruptAiAnalysis, aiConfiguration } from "./ai-analysis-service";
import { loadAiRun, listAiRuns, reserveAiTurn } from "@/db/repositories/ai-analysis-repository";
import { findEtfById } from "@/db/repositories/catalog-repository";
import { persistSnapshot } from "@/db/repositories/holdings-repository";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { closeDatabase } from "@/db/client";
import { readAiBody } from "./ai-route";

const oldEnv = { ...process.env };
const directory = mkdtempSync(join(tmpdir(), "weightings-ai-"));
const token = "test-backend-token";
const threads = new Map<string, T3Thread>();
const commands: Record<string, unknown>[] = [];
let protocol = 1;
const config: T3Config = {
  providers: [{ instanceId: "weightings-analysis", driver: "codex", displayName: "Research", enabled: true, status: "ready", auth: { status: "authenticated" }, models: [
    { slug: "test-model", name: "Test model", isDefault: true, capabilities: { optionDescriptors: [{ id: "reasoningEffort", options: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }] }] } },
    { slug: "simple-model", name: "Simple" },
  ] }],
  settings: { providerInstances: { "weightings-analysis": { config: { launchArgs: '-c web_search="live"' } } } },
};
const server = createServer(async (req, res) => {
  const send = (body: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/.well-known/t3/environment") return send({ environmentId: "test-environment", serverVersion: "0.0.45", orchestrationProtocolVersion: protocol });
  if (req.headers.authorization !== `Bearer ${token}`) return send({ error: "secret error contents must not escape" }, 401);
  if (req.url === "/api/auth/websocket-ticket") return send({ ticket: "test-ticket" });
  if (req.url === "/api/orchestration/shell") return send({ projects: [{ id: "weightings-analysis" }] });
  if (req.url?.startsWith("/api/orchestration/threads/")) {
    const id = req.url.split("/").at(-1)!.split("?")[0];
    return threads.has(id) ? send({ thread: threads.get(id) }) : send({}, 404);
  }
  if (req.url === "/api/orchestration/dispatch") {
    let body = ""; for await (const chunk of req) body += chunk;
    const c = JSON.parse(body); commands.push(c);
    if (c.type === "thread.create") threads.set(c.threadId, { id: c.threadId, messages: [], latestTurn: null, session: null, activities: [] });
    if (c.type === "thread.turn.start") {
      const thread = threads.get(c.threadId)!;
      thread.messages.push({ id: c.message.messageId, role: "user", text: c.message.text });
      thread.latestTurn = { state: "running", requestedAt: c.createdAt };
      thread.session = { status: "running", lastError: null };
    }
    if (c.type === "thread.turn.interrupt") { threads.get(c.threadId)!.latestTurn!.state = "interrupted"; }
    if (c.type === "thread.approval.respond") threads.get(c.threadId)!.activities.push({ kind: "approval.resolved", summary: "Declined", payload: { requestId: c.requestId } });
    return send({ sequence: commands.length });
  }
  send({}, 404);
});
const ws = new WebSocketServer({ server });
ws.on("connection", (socket, request) => {
  assert.equal(request.url, "/ws?wsTicket=test-ticket");
  socket.on("message", (data) => {
    const c = JSON.parse(data.toString());
    assert.equal(c.tag, "server.getConfig");
    socket.send(JSON.stringify({ _tag: "Exit", requestId: c.id, exit: { _tag: "Success", value: config } }));
  });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  writeFileSync(join(directory, "token"), token);
  Object.assign(process.env, { DATABASE_PATH: join(directory, "db.sqlite"), T3_BASE_URL: `http://127.0.0.1:${port}`, T3_AUTH_TOKEN_FILE: join(directory, "token"), T3_PROVIDER_INSTANCE: "weightings-analysis", T3_PROJECT_ID: "weightings-analysis" });
  closeDatabase(); ensureLocalDatabase();
  const etf = findEtfById("ivv-us")!;
  persistSnapshot({ etf, asOf: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), sourceUrl: "https://example.test/holdings", sourceHash: "ai-test", holdings: [{ securityId: "US0378331005", ticker: "AAPL", name: "Apple", sector: "Technology", country: "United States", assetClass: "Equity", weight: 100 }] });
});
after(async () => { ws.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDatabase(); process.env = oldEnv; rmSync(directory, { recursive: true, force: true }); });

const request = () => parseAiRequest({ target: { kind: "etf", reference: "ivv-us" }, template: "overview", model: "test-model", effort: "high", language: "fr", question: "" });
test("validates targets, model selections and bounded request bodies", async () => {
  assert.throws(() => parseAiRequest({ ...request(), target: { kind: "etf", reference: "../private" } }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), template: "arbitrary-command" }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), question: "x".repeat(4001) }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), runId: randomUUID() }), AiError);
  await assert.rejects(readAiBody(new Request("http://localhost", { method: "POST", body: "x".repeat(17000) })), (e: unknown) => e instanceof AiError && e.status === 413);
});
test("discovers model-specific efforts and requires live search", () => {
  const result = analysisModels(config, "weightings-analysis");
  assert.equal(result.models[0].defaultEffort, "high");
  assert.deepEqual(result.models[1].efforts, []);
  assert.throws(() => analysisModels({ ...config, settings: { providerInstances: {} } }, "weightings-analysis"), /Live web search/);
});
test("custom analysis requires a question without adding a predefined template", () => {
  assert.throws(() => parseAiRequest({ ...request(), template: "custom", question: "   " }), /custom analysis question/);
  const custom = parseAiRequest({ ...request(), template: "custom", question: "Compare these holdings with an equal-weight allocation." });
  const prompt = analysisPrompt(custom, { ticker: "IVV" });
  assert.ok(prompt.includes(custom.question));
  for (const template of AI_TEMPLATES.filter((t) => t.id !== "custom")) assert.ok(!prompt.includes(template.prompt));
  assert.match(prompt, /IVV/);
});
test("transmits canonical holdings, model and effort; resumes safely and interrupts", async () => {
  assert.equal((await aiConfiguration()).connected, true);
  const run = await startAiAnalysis(request());
  const stored = loadAiRun(run.id);
  const command = commands.at(-1)!;
  assert.equal(command.type, "thread.turn.start");
  assert.equal(command.runtimeMode, "approval-required");
  assert.deepEqual(command.modelSelection, { instanceId: "weightings-analysis", model: "test-model", options: [{ id: "reasoningEffort", value: "high" }] });
  const text = (command.message as { text: string }).text;
  assert.match(text, /AAPL/); assert.match(text, /Research fresh/); assert.match(text, /French/);
  assert.equal((await aiSnapshot(run.id)).state, "running");
  await assert.rejects(startAiAnalysis({ ...request(), question: "follow up", runId: run.id }), /already running/);
  const thread = threads.get(stored.threadId)!;
  thread.messages.push({ id: "assistant-1", role: "assistant", text: "## Analyse\n[Source](https://example.test)" });
  thread.latestTurn!.state = "completed";
  assert.equal((await aiSnapshot(run.id)).messages.at(-1)!.text, thread.messages.at(-1)!.text);
  assert.equal(loadAiRun(run.id).pendingMessageId, null);
  const continued = await startAiAnalysis({ ...request(), effort: "low", question: "Et la concentration ?", runId: run.id });
  assert.equal(continued.id, run.id);
  assert.equal(loadAiRun(run.id).threadId, stored.threadId);
  assert.equal(reserveAiTurn(run.id, randomUUID(), request()), false);
  await interruptAiAnalysis(run.id);
  assert.equal((await aiSnapshot(run.id)).state, "interrupted");
  assert.equal(listAiRuns().length, 1);
  await assert.rejects(aiSnapshot(randomUUID()), /not found/);
});
test("does not forward arbitrary model/effort combinations or tool permissions", async () => {
  await assert.rejects(startAiAnalysis({ ...request(), effort: "ultra" }), /no longer available/);
  const run = listAiRuns()[0]; const thread = threads.get(loadAiRun(run.id).threadId)!;
  thread.activities.push({ kind: "approval.requested", summary: "Execute command", payload: { requestId: "approval-1" } });
  await aiSnapshot(run.id);
  assert.equal(commands.at(-1)!.decision, "decline");
});
test("rejects expired credentials and unsupported protocols without leaking upstream errors", async () => {
  const client = new T3Client(new URL(process.env.T3_BASE_URL!), "wrong-token");
  await assert.rejects(client.http("/api/orchestration/shell"), (e: unknown) => e instanceof AiError && e.message.includes("expired") && !e.message.includes("secret"));
  protocol = 2;
  assert.equal((await aiConfiguration()).connected, false);
  protocol = 1;
});
test("full aggregates retain signed weights and explicitly disclose the truncated tail", () => {
  const positions = Array.from({ length: 205 }, (_, index) => ({ securityId: `s${index}`, ticker: `T${index}`, name: "Security", sector: "Technology", country: "United States", assetClass: "Equity", weight: index === 0 ? -20 : 1 }));
  const context = positionContext(positions);
  assert.equal(context.listedPositions[0].weightPct, -20);
  assert.equal(context.omittedPositions, 5); assert.equal(context.omittedGrossWeightPct, 5);
  assert.equal(context.netWeightPct, 184); assert.equal(context.grossWeightPct, 224);
  assert.match(analysisPrompt(request(), context), /Quantities|quantities/);
});
