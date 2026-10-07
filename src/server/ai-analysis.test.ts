import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { AI_TEMPLATES, AI_POSITION_DEFAULTS, AiError, parseAiRequest } from "@/domain/ai-analysis";
import { T3Client, analysisModels, type T3Config, type T3Thread } from "./t3-client";
import { analysisContext, analysisPrompt, needsAiSnapshot, positionContext } from "./ai-context";
import { startAiAnalysis, aiSnapshot, interruptAiAnalysis, aiConfiguration } from "./ai-analysis-service";
import { loadAiRun, listAiRuns, reserveAiTurn } from "@/db/repositories/ai-analysis-repository";
import { findEtfById } from "@/db/repositories/catalog-repository";
import { persistSnapshot } from "@/db/repositories/holdings-repository";
import { ISHARES_HOLDINGS_HASH_PREFIX } from "@/data/providers/ishares-csv";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { closeDatabase, getSqlite } from "@/db/client";
import { readAiBody } from "./ai-route";

const oldEnv = { ...process.env };
const directory = mkdtempSync(join(tmpdir(), "weightings-ai-"));
const token = "test-backend-token";
const threads = new Map<string, T3Thread>();
const commands: Record<string, unknown>[] = [];
let protocol = 1;
let dispatchFailure: "before" | "after" | null = null;
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
      if (dispatchFailure === "before") return send({}, 503);
      const thread = threads.get(c.threadId)!;
      thread.messages.push({ id: c.message.messageId, role: "user", text: c.message.text });
      thread.latestTurn = { state: "running", requestedAt: c.createdAt };
      thread.session = { status: "running", lastError: null };
      if (dispatchFailure === "after") return send({}, 503);
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
  // A current-format, plausible fixture avoids downloading live fund holdings.
  persistSnapshot({ etf, asOf: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), sourceUrl: "https://example.test/holdings", sourceHash: `${ISHARES_HOLDINGS_HASH_PREFIX}ai-test`, holdings: ["AAPL", "MSFT", "NVDA", "AMZN", "META"].map((ticker, index) => ({ securityId: `ai-fixture-${ticker}`, ticker, name: ticker, sector: "Technology", country: "United States", assetClass: "Equity", weight: index === 0 ? 60 : 10 })) });
});
after(async () => { ws.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); closeDatabase(); process.env = oldEnv; rmSync(directory, { recursive: true, force: true }); });

const request = () => parseAiRequest({ target: { kind: "etf", reference: "ivv-us" }, template: "overview", model: "test-model", effort: "high", language: "fr", question: "" });
test("validates targets, model selections and bounded request bodies", async () => {
  assert.throws(() => parseAiRequest({ ...request(), target: { kind: "etf", reference: "../private" } }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), template: "arbitrary-command" }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), question: "x".repeat(4001) }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), runId: randomUUID() }), AiError);
  assert.throws(() => parseAiRequest({ ...request(), refreshSnapshot: "true" }), /refresh option/);
  assert.equal(parseAiRequest({ ...request(), refreshSnapshot: true }).refreshSnapshot, true);
  for (const positionLimit of [-1, 201, 1.5, "20", null, NaN, Infinity]) assert.throws(() => parseAiRequest({ ...request(), positionLimit }), /positions/);
  for (const positionLimit of [0, 1, 200]) assert.equal(parseAiRequest({ ...request(), positionLimit }).positionLimit, positionLimit);
  for (const template of AI_TEMPLATES) assert.equal(parseAiRequest({ ...request(), template: template.id, question: "Analyse", positionLimit: undefined }).positionLimit, AI_POSITION_DEFAULTS[template.id]);
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
  assert.ok(stored.snapshotSentAt);
  assert.equal(stored.pendingSnapshotSentAt, null);
  const command = commands.at(-1)!;
  assert.equal(command.type, "thread.turn.start");
  assert.equal(command.runtimeMode, "approval-required");
  assert.deepEqual(command.modelSelection, { instanceId: "weightings-analysis", model: "test-model", options: [{ id: "reasoningEffort", value: "high" }] });
  const text = (command.message as { text: string }).text;
  assert.match(text, /AAPL/); assert.match(text, /Research fresh/); assert.match(text, /French/);
  const data = JSON.parse(text.match(/<application_snapshot>\n(.*)\n<\/application_snapshot>/)![1]);
  assert.deepEqual(data.listedPositions[0], { ticker: "AAPL", name: "AAPL", weightPct: 60 });
  assert.equal(data.listedPositions.length, 5);
  assert.equal(stored.snapshotPositionLimit, 20);
  assert.equal("_snapshotPositionLimit" in run.request, false);
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
  assert.equal(continued.snapshotSentAt, stored.snapshotSentAt);
  const followUpText = (commands.at(-1)!.message as { text: string }).text;
  assert.doesNotMatch(followUpText, /<application_snapshot>|AAPL|newly supplied snapshot/);
  assert.match(followUpText, new RegExp(stored.snapshotSentAt!));
  assert.equal((await aiSnapshot(run.id)).messages.at(-1)!.text, "Et la concentration ?");
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
test("snapshot reuse expires at 24 hours and supports a manual refresh", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const followUp = { ...request(), runId: randomUUID(), question: "Follow-up" };
  assert.equal(needsAiSnapshot(request(), new Date(now).toISOString(), now), true);
  assert.equal(needsAiSnapshot(followUp, new Date(now - 24 * 60 * 60 * 1000 + 1).toISOString(), now), false);
  assert.equal(needsAiSnapshot(followUp, new Date(now - 24 * 60 * 60 * 1000).toISOString(), now), true);
  assert.equal(needsAiSnapshot(followUp, null, now), true);
  assert.equal(needsAiSnapshot(followUp, "invalid", now), true);
  assert.equal(needsAiSnapshot(followUp, new Date(now + 1000).toISOString(), now), true);
  assert.equal(needsAiSnapshot({ ...followUp, refreshSnapshot: true }, new Date(now).toISOString(), now), true);
});
test("refreshes expired or legacy snapshots and persists manual refreshes across database reopen", async () => {
  const run = await startAiAnalysis(request());
  const stored = loadAiRun(run.id);
  const thread = threads.get(stored.threadId)!;
  const finish = async () => { thread.latestTurn!.state = "completed"; await aiSnapshot(run.id); };
  const prompt = () => (commands.at(-1)!.message as { text: string }).text;
  await finish();
  const oldSnapshot = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  // A recent question must not extend the snapshot's lifetime.
  getSqlite().prepare("UPDATE ai_analysis_runs SET snapshot_sent_at = ?, updated_at = ? WHERE id = ?").run(oldSnapshot, new Date().toISOString(), run.id);
  const refreshed = await startAiAnalysis({ ...request(), runId: run.id, question: "Update the analysis." });
  assert.match(prompt(), /<application_snapshot>|AAPL/);
  assert.notEqual(refreshed.snapshotSentAt, oldSnapshot);
  await finish();
  const priorSend = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  getSqlite().prepare("UPDATE ai_analysis_runs SET snapshot_sent_at = ? WHERE id = ?").run(priorSend, run.id);
  const forced = await startAiAnalysis({ ...request(), runId: run.id, question: "Use my latest holdings.", refreshSnapshot: true });
  assert.match(prompt(), /<application_snapshot>|AAPL/);
  assert.notEqual(forced.snapshotSentAt, priorSend);
  await finish();
  closeDatabase();
  assert.equal(loadAiRun(run.id).snapshotSentAt, forced.snapshotSentAt);
  const reused = await startAiAnalysis({ ...request(), runId: run.id, question: "And the risks?" });
  assert.doesNotMatch(prompt(), /<application_snapshot>|listedPositions|AAPL/);
  assert.equal(reused.snapshotSentAt, forced.snapshotSentAt);
  await finish();
  getSqlite().prepare("UPDATE ai_analysis_runs SET snapshot_sent_at = NULL WHERE id = ?").run(run.id);
  const legacy = await startAiAnalysis({ ...request(), runId: run.id, question: "Resume this older conversation." });
  assert.match(prompt(), /<application_snapshot>|AAPL/);
  assert.ok(legacy.snapshotSentAt);
  await finish();
});
test("does not mark rejected snapshots as sent and reconciles accepted dispatches with lost responses", async () => {
  const run = await startAiAnalysis(request());
  const stored = loadAiRun(run.id);
  const thread = threads.get(stored.threadId)!;
  thread.latestTurn!.state = "completed";
  await aiSnapshot(run.id);
  const previousSend = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  getSqlite().prepare("UPDATE ai_analysis_runs SET snapshot_sent_at = ? WHERE id = ?").run(previousSend, run.id);
  const followUp = { ...request(), runId: run.id, question: "Refresh these holdings.", refreshSnapshot: true };
  dispatchFailure = "before";
  try { await assert.rejects(startAiAnalysis(followUp), /could not process/); }
  finally { dispatchFailure = null; }
  assert.equal(loadAiRun(run.id).snapshotSentAt, previousSend);
  assert.ok(loadAiRun(run.id).pendingSnapshotSentAt);
  getSqlite().prepare("UPDATE ai_analysis_runs SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 91_000).toISOString(), run.id);
  assert.equal((await aiSnapshot(run.id)).state, "error");
  assert.equal(loadAiRun(run.id).snapshotSentAt, previousSend);
  assert.equal(loadAiRun(run.id).pendingSnapshotSentAt, null);
  dispatchFailure = "after";
  try { await assert.rejects(startAiAnalysis(followUp), /could not process/); }
  finally { dispatchFailure = null; }
  const candidateSend = loadAiRun(run.id).pendingSnapshotSentAt;
  assert.ok(candidateSend);
  assert.equal(loadAiRun(run.id).snapshotSentAt, previousSend);
  const accepted = await aiSnapshot(run.id);
  assert.equal(accepted.run.snapshotSentAt, candidateSend);
  assert.equal(loadAiRun(run.id).pendingSnapshotSentAt, null);
  thread.latestTurn!.state = "completed";
  await aiSnapshot(run.id);
  const reused = await startAiAnalysis({ ...request(), runId: run.id, question: "Continue." });
  assert.equal(reused.snapshotSentAt, candidateSend);
  assert.doesNotMatch((commands.at(-1)!.message as { text: string }).text, /<application_snapshot>|AAPL/);
  thread.latestTurn!.state = "completed";
  await aiSnapshot(run.id);
});
test("rejects expired credentials and unsupported protocols without leaking upstream errors", async () => {
  const client = new T3Client(new URL(process.env.T3_BASE_URL!), "wrong-token");
  await assert.rejects(client.http("/api/orchestration/shell"), (e: unknown) => e instanceof AiError && e.message.includes("expired") && !e.message.includes("secret"));
  protocol = 2;
  assert.equal((await aiConfiguration()).connected, false);
  protocol = 1;
});

test("template context keeps full summary while omitting individual holdings at zero", async () => {
  const { context: overview } = await analysisContext({ ...request(), positionLimit: 0 });
  assert.deepEqual(overview.listedPositions, []);
  assert.equal(overview.omittedPositions, 5);
  assert.equal(overview.omittedGrossWeightPct, 100);
  assert.equal(overview.top10WeightPct, 100);
  assert.deepEqual(overview.sectors, [{ name: "Technology", weightPct: 100 }]);
  assert.deepEqual(overview.countries, [{ name: "United States", weightPct: 100 }]);
  const { context: news } = await analysisContext({ ...request(), template: "news" });
  assert.ok("fund" in news && news.fund);
  assert.equal("ter" in news.fund, false);
  assert.equal("securityId" in news.listedPositions[0], false);
});

test("changing the budget refreshes the snapshot and failed sends preserve the accepted budget", async () => {
  const run = await startAiAnalysis({ ...request(), positionLimit: 0 });
  const stored = loadAiRun(run.id);
  const thread = threads.get(stored.threadId)!;
  const finish = async () => { thread.latestTurn!.state = "completed"; await aiSnapshot(run.id); };
  const prompt = () => (commands.at(-1)!.message as { text: string }).text;
  assert.doesNotMatch(prompt(), /AAPL/);
  assert.match(prompt(), /"omittedGrossWeightPct":100/);
  await finish();
  closeDatabase();
  assert.equal(loadAiRun(run.id).snapshotPositionLimit, 0);
  const next = { ...request(), runId: run.id, question: "Main positions?", positionLimit: 10 };
  dispatchFailure = "before";
  try { await assert.rejects(startAiAnalysis(next), /could not process/); }
  finally { dispatchFailure = null; }
  assert.equal(loadAiRun(run.id).snapshotPositionLimit, 0);
  getSqlite().prepare("UPDATE ai_analysis_runs SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 91_000).toISOString(), run.id);
  await aiSnapshot(run.id);
  await startAiAnalysis(next);
  assert.match(prompt(), /<application_snapshot>|AAPL/);
  assert.equal(loadAiRun(run.id).snapshotPositionLimit, 10);
  await finish();
  await startAiAnalysis(next);
  assert.doesNotMatch(prompt(), /<application_snapshot>|AAPL/);
  await finish();
});
test("full aggregates retain signed weights and explicitly disclose the truncated tail", () => {
  const positions = Array.from({ length: 205 }, (_, index) => ({ securityId: `s${index}`, ticker: `T${index}`, name: "Security", sector: "Technology", country: "United States", assetClass: "Equity", weight: index === 0 ? -20 : 1 }));
  const context = positionContext(positions, 200);
  assert.equal(context.listedPositions[0].weightPct, -20);
  assert.equal(context.omittedPositions, 5); assert.equal(context.omittedGrossWeightPct, 5);
  assert.equal(context.netWeightPct, 184); assert.equal(context.grossWeightPct, 224);
  assert.match(analysisPrompt(request(), context), /Quantities|quantities/);
});

test("small budgets retain signed ranking and round after aggregating the full composition", () => {
  const positions = [
    { securityId: "a", ticker: "A", name: "Short", sector: "Tech", country: "US", assetClass: "Equity", weight: -20.123456 },
    { securityId: "b", ticker: "B", name: "Long", sector: "Tech", country: "US", assetClass: "Equity", weight: 10.004 },
    { securityId: "c", ticker: "C", name: "Long", sector: "Tech", country: "US", assetClass: "Equity", weight: 10.004 },
  ];
  const context = positionContext(positions, 1);
  assert.deepEqual(context.listedPositions, [{ ticker: "A", name: "Short", weightPct: -20.12 }]);
  assert.equal(context.omittedPositions, 2);
  assert.equal(context.omittedGrossWeightPct, 20.01);
  assert.equal(context.netWeightPct, -0.12);
  assert.equal(context.grossWeightPct, 40.13);
  assert.deepEqual(context.sectors, [{ name: "Tech", weightPct: -0.12 }]);
  assert.equal(positionContext(positions, 0).listedPositions.length, 0);
  assert.throws(() => positionContext(positions, 201), /position limit/);
});
