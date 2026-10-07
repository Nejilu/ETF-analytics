import "server-only";
import { randomUUID } from "node:crypto";
import { AiError, aiPositionLimit, type AiAnalysisRequest, type AiConfiguration, type AiSnapshot } from "@/domain/ai-analysis";
import { confirmAiSnapshotSent, loadAiRun, pendingAiRunIds, publicAiRun, releaseAiTurn, reserveAiTurn, saveAiRun, type StoredAiRun } from "@/db/repositories/ai-analysis-repository";
import { analysisContext, analysisPrompt, needsAiSnapshot } from "./ai-context";
import { analysisModels, T3Client } from "./t3-client";

export async function aiConfiguration(): Promise<AiConfiguration> {
  try {
    const t3 = await T3Client.configured();
    const config = await t3.client.rpc<Parameters<typeof analysisModels>[0]>("server.getConfig", {});
    return { connected: true, ...analysisModels(config, t3.instanceId), serverVersion: t3.descriptor.serverVersion };
  } catch (error) {
    return { connected: false, models: [], message: error instanceof AiError ? error.message : "T3 is temporarily unavailable." };
  }
}

async function runConnection(run: StoredAiRun) {
  const t3 = await T3Client.configured();
  if (run.environmentId !== t3.descriptor.environmentId) throw new AiError(409, "This analysis belongs to another T3 environment. Reconnect that environment to resume it.");
  return t3;
}

export async function aiSnapshot(id: string): Promise<AiSnapshot> {
  const run = loadAiRun(id);
  const t3 = await runConnection(run);
  const { thread } = await t3.client.thread(run.threadId);
  const pendingSeen = !run.pendingMessageId || thread.messages.some((m) => m.id === run.pendingMessageId);
  if (pendingSeen && run.pendingMessageId && run.pendingSnapshotSentAt) {
    confirmAiSnapshotSent(run.id, run.pendingMessageId);
    run.snapshotSentAt = run.pendingSnapshotSentAt;
  }
  const dispatchExpired = !pendingSeen && Date.now() - Date.parse(run.updatedAt ?? run.createdAt) > 90_000;
  const state = dispatchExpired ? "error" : !pendingSeen ? "starting" : thread.latestTurn?.state ?? (run.pendingMessageId ? "starting" : "completed");
  // Deny requests to expand permissions. This panel is for research only;
  // it never gives the agent permission to change files or external systems.
  const resolved = new Set(thread.activities.filter((a) => a.kind === "approval.resolved").map((a) => a.payload.requestId));
  for (const activity of thread.activities.filter((a) => a.kind === "approval.requested" && !resolved.has(a.payload.requestId))) {
    if (typeof activity.payload.requestId === "string") await t3.client.dispatch({ type: "thread.approval.respond", commandId: randomUUID(), threadId: run.threadId, requestId: activity.payload.requestId, decision: "decline", createdAt: new Date().toISOString() });
  }
  const sessionFailed = thread.session?.status === "error";
  if (dispatchExpired || (pendingSeen && (sessionFailed || ["completed", "interrupted", "error"].includes(state)))) releaseAiTurn(run.id, run.pendingMessageId);
  return {
    run: publicAiRun(run), state: sessionFailed ? "error" : state,
    messages: thread.messages.filter((m) => m.role === "assistant" || m.role === "user").map((m) => ({ id: m.id, role: m.role as "assistant" | "user", text: m.role === "user" ? displayUserMessage(m.text) : m.text })),
    activities: thread.activities.slice(-6).map((a) => a.kind === "approval.requested" ? "An elevated tool permission was declined; research remains read-only." : a.summary),
    ...(sessionFailed || state === "error" ? { error: "Codex could not complete this analysis. Check the account quota and provider status in T3, then try again." } : {}),
  };
}

function displayUserMessage(prompt: string): string {
  const match = prompt.match(/Owner's additional question[^\n]*:\n([\s\S]*?)\n<application_snapshot(?:_reference)?>/);
  return match?.[1] && match[1] !== "None." ? match[1] : "Analyse the selected holdings with the chosen template.";
}

export async function startAiAnalysis(request: AiAnalysisRequest) {
  request = { ...request, positionLimit: aiPositionLimit(request) };
  const t3 = await T3Client.configured();
  const config = await t3.client.rpc<Parameters<typeof analysisModels>[0]>("server.getConfig", {});
  const { models } = analysisModels(config, t3.instanceId);
  const model = models.find((m) => m.id === request.model);
  if (!model || (model.efforts.length ? !model.efforts.some((e) => e.id === request.effort) : request.effort !== "")) throw new AiError(400, "This model or reasoning effort is no longer available. Reload the model list.");
  let run: StoredAiRun | undefined;
  if (request.runId) {
    run = loadAiRun(request.runId);
    if (run.environmentId !== t3.descriptor.environmentId) throw new AiError(409, "This analysis belongs to another T3 environment.");
    if (JSON.stringify(run.request.target) !== JSON.stringify(request.target)) throw new AiError(400, "Start a new analysis to change the ETF or portfolio.");
    const snapshot = await aiSnapshot(run.id);
    if (snapshot.state === "running" || snapshot.state === "starting") throw new AiError(409, "An analysis is already running in this conversation.");
    run = loadAiRun(run.id);
  }
  const includeSnapshot = needsAiSnapshot(request, run?.snapshotSentAt ?? null) || run?.snapshotPositionLimit !== request.positionLimit;
  const data = includeSnapshot ? await analysisContext(request) : undefined;
  const createdAt = new Date().toISOString();
  const prompt = analysisPrompt(request, data?.context, createdAt, run?.snapshotSentAt ?? null);
  // Agents continue when a tab is closed. Reconcile finished reservations
  // before admitting a new turn, even if no browser watched their completion.
  await Promise.allSettled(pendingAiRunIds(t3.descriptor.environmentId).map(aiSnapshot));
  const messageId = randomUUID();
  const modelSelection = { instanceId: t3.instanceId, model: request.model, options: request.effort ? [{ id: "reasoningEffort", value: request.effort }] : [] };
  if (!run) {
    const shell = await t3.client.http<{ projects: { id: string }[] }>("/api/orchestration/shell");
    if (!shell.projects.some((p) => p.id === t3.projectId)) throw new AiError(503, "The dedicated analysis project is missing in T3. Run the connection setup on the T3 host.");
    run = { id: randomUUID(), environmentId: t3.descriptor.environmentId, threadId: randomUUID(), title: data!.title, request, pendingMessageId: null, snapshotSentAt: null, pendingSnapshotSentAt: null, createdAt };
    await t3.client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId: run.threadId, projectId: t3.projectId, title: `Analysis · ${run.title}`.slice(0, 180), modelSelection, runtimeMode: "approval-required", interactionMode: "default", branch: null, worktreePath: null, createdAt });
    saveAiRun(run);
  }
  if (!reserveAiTurn(run.id, messageId, request, includeSnapshot ? createdAt : null)) throw new AiError(409, "An analysis is already starting in this conversation.");
  // A timeout can hide an accepted dispatch. Keep the reservation until a
  // snapshot confirms the outcome rather than risking a duplicate turn.
  await t3.client.dispatch({ type: "thread.turn.start", commandId: randomUUID(), threadId: run.threadId, message: { messageId, role: "user", text: prompt, attachments: [] }, modelSelection, runtimeMode: "approval-required", interactionMode: "default", createdAt });
  confirmAiSnapshotSent(run.id, messageId);
  return publicAiRun(loadAiRun(run.id));
}

export async function interruptAiAnalysis(id: string) {
  const run = loadAiRun(id);
  const t3 = await runConnection(run);
  await t3.client.dispatch({ type: "thread.turn.interrupt", commandId: randomUUID(), threadId: run.threadId, createdAt: new Date().toISOString() });
}
