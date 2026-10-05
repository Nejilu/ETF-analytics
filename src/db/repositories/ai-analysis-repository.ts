import "server-only";
import { ensureLocalDatabase } from "../bootstrap";
import { getSqlite } from "../client";
import { AiError, type AiAnalysisRequest, type AiRun, isAiRunId } from "@/domain/ai-analysis";

export interface StoredAiRun extends AiRun { environmentId: string; threadId: string; pendingMessageId: string | null; updatedAt?: string }
interface Row { id: string; environment_id: string; thread_id: string; title: string; request_json: string; pending_message_id: string | null; created_at: string; updated_at: string }
function decode(row: Row): StoredAiRun {
  return { id: row.id, title: row.title, createdAt: row.created_at, request: JSON.parse(row.request_json) as AiAnalysisRequest, environmentId: row.environment_id, threadId: row.thread_id, pendingMessageId: row.pending_message_id, updatedAt: row.updated_at };
}
export function publicAiRun(run: StoredAiRun): AiRun { return { id: run.id, title: run.title, createdAt: run.createdAt, request: run.request }; }
export function saveAiRun(run: StoredAiRun) {
  ensureLocalDatabase();
  getSqlite().prepare("INSERT INTO ai_analysis_runs (id, environment_id, thread_id, title, request_json, pending_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(run.id, run.environmentId, run.threadId, run.title, JSON.stringify(run.request), run.pendingMessageId, run.createdAt, run.createdAt);
}
export function loadAiRun(id: string): StoredAiRun {
  if (!isAiRunId(id)) throw new AiError(404, "Analysis not found.");
  ensureLocalDatabase();
  const row = getSqlite().prepare("SELECT * FROM ai_analysis_runs WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new AiError(404, "Analysis not found.");
  return decode(row);
}
export function listAiRuns(): AiRun[] {
  ensureLocalDatabase();
  return (getSqlite().prepare("SELECT * FROM ai_analysis_runs ORDER BY updated_at DESC LIMIT 30").all() as Row[]).map((row) => publicAiRun(decode(row)));
}
export function pendingAiRunIds(environmentId: string): string[] {
  ensureLocalDatabase();
  return (getSqlite().prepare("SELECT id FROM ai_analysis_runs WHERE environment_id = ? AND pending_message_id IS NOT NULL LIMIT 2").all(environmentId) as { id: string }[]).map((r) => r.id);
}
export function reserveAiTurn(id: string, messageId: string, request: AiAnalysisRequest): boolean {
  ensureLocalDatabase();
  return getSqlite().transaction(() => {
    const count = (getSqlite().prepare("SELECT COUNT(*) AS n FROM ai_analysis_runs WHERE environment_id = (SELECT environment_id FROM ai_analysis_runs WHERE id = ?) AND pending_message_id IS NOT NULL").get(id) as { n: number }).n;
    if (count >= 2) throw new AiError(429, "Two analyses are already running. Reopen or stop them before starting another.");
    return getSqlite().prepare("UPDATE ai_analysis_runs SET pending_message_id = ?, request_json = ?, updated_at = ? WHERE id = ? AND pending_message_id IS NULL").run(messageId, JSON.stringify(request), new Date().toISOString(), id).changes === 1;
  }).immediate();
}
export function releaseAiTurn(id: string, messageId: string | null) {
  if (messageId) getSqlite().prepare("UPDATE ai_analysis_runs SET pending_message_id = NULL WHERE id = ? AND pending_message_id = ?").run(id, messageId);
}
