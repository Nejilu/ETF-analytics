export const AI_TEMPLATES = [
  { id: "custom", title: "Custom", description: "Your own question, without a predefined analysis.", prompt: "" },
  { id: "overview", title: "Global analysis", description: "Strengths, weaknesses and the main risks.", prompt: "Provide a balanced global analysis, strengths, weaknesses, key risks and questions worth investigating." },
  { id: "positions", title: "Main positions", description: "What the largest holdings contribute.", prompt: "Analyse the largest positions, their business exposure, recent earnings and catalysts, and their contribution to concentration and risk." },
  { id: "diversification", title: "Diversification & balance", description: "Concentration, overlaps, sectors and geography.", prompt: "Assess diversification and balance across holdings, sectors, geography and currencies. Identify overlaps, concentration and common risk factors. Equal weights do not imply equal risk." },
  { id: "coherence", title: "Portfolio coherence", description: "How the exposures fit together.", prompt: "Assess whether the exposures fit together coherently. Identify redundancies, contradictory exposures, leverage and gaps. Do not assume an investment objective, horizon or risk tolerance that was not supplied." },
  { id: "news", title: "Recent news & earnings", description: "Fresh developments affecting the main exposures.", prompt: "Research recent material news, earnings, guidance and market developments affecting the largest exposures. Include publication dates and event dates. Separate confirmed facts, market expectations and unverified rumours." },
] as const;

export type AiTemplateId = (typeof AI_TEMPLATES)[number]["id"];
export const AI_MAX_POSITIONS = 200;
export const AI_POSITION_DEFAULTS: Record<AiTemplateId, number> = {
  custom: 20, overview: 20, positions: 30, diversification: 10, coherence: 20, news: 10,
};
export function aiPositionLimit(request: Pick<AiAnalysisRequest, "template" | "positionLimit">) {
  return request.positionLimit ?? AI_POSITION_DEFAULTS[request.template];
}
export interface AiModel {
  id: string;
  name: string;
  isDefault: boolean;
  efforts: { id: string; label: string }[];
  defaultEffort: string;
}
export interface AiConfiguration {
  connected: boolean;
  message?: string;
  models: AiModel[];
  providerName?: string;
  serverVersion?: string;
}
export interface AiAnalysisRequest {
  target: { kind: "portfolio" } | { kind: "etf"; reference: string };
  template: AiTemplateId;
  model: string;
  effort: string;
  language: "fr" | "en";
  question: string;
  runId?: string;
  refreshSnapshot?: boolean;
  positionLimit?: number;
}
export interface AiRun {
  id: string;
  title: string;
  createdAt: string;
  request: AiAnalysisRequest;
  snapshotSentAt: string | null;
}
export interface AiMessage { id: string; role: "user" | "assistant"; text: string }
export interface AiSnapshot {
  run: AiRun;
  messages: AiMessage[];
  state: "starting" | "running" | "completed" | "interrupted" | "error";
  activities: string[];
  error?: string;
}

export class AiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
export const isAiRunId = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);

export function parseAiRequest(value: unknown): AiAnalysisRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError(400, "Invalid analysis request.");
  const v = value as Record<string, unknown>;
  const target = v.target as Record<string, unknown> | undefined;
  if (!target || (target.kind !== "portfolio" && target.kind !== "etf") ||
    (target.kind === "etf" && (typeof target.reference !== "string" || !identifier.test(target.reference)))) throw new AiError(400, "Select a valid ETF or portfolio.");
  if (!AI_TEMPLATES.some((t) => t.id === v.template)) throw new AiError(400, "Select an analysis template.");
  if (typeof v.model !== "string" || !identifier.test(v.model) || typeof v.effort !== "string" || (v.effort !== "" && !identifier.test(v.effort))) throw new AiError(400, "Invalid model or reasoning effort.");
  if (v.language !== "fr" && v.language !== "en") throw new AiError(400, "Invalid response language.");
  if (typeof v.question !== "string" || v.question.length > 4000) throw new AiError(400, "The question must be at most 4,000 characters.");
  if (v.runId !== undefined && (typeof v.runId !== "string" || !isAiRunId(v.runId))) throw new AiError(400, "Invalid analysis identifier.");
  if (v.refreshSnapshot !== undefined && typeof v.refreshSnapshot !== "boolean") throw new AiError(400, "Invalid holdings refresh option.");
  if (v.positionLimit !== undefined && (typeof v.positionLimit !== "number" || !Number.isInteger(v.positionLimit) || v.positionLimit < 0 || v.positionLimit > AI_MAX_POSITIONS)) throw new AiError(400, `Choose between 0 and ${AI_MAX_POSITIONS} positions.`);
  if (v.runId && !v.question.trim()) throw new AiError(400, "Enter a follow-up question.");
  if (v.template === "custom" && !v.question.trim()) throw new AiError(400, "Enter your custom analysis question.");
  return { target: target.kind === "portfolio" ? { kind: "portfolio" } : { kind: "etf", reference: target.reference as string }, template: v.template as AiTemplateId, positionLimit: typeof v.positionLimit === "number" ? v.positionLimit : AI_POSITION_DEFAULTS[v.template as AiTemplateId], model: v.model, effort: v.effort, language: v.language, question: v.question.trim(), ...(v.runId ? { runId: v.runId as string } : {}), ...(v.refreshSnapshot === true ? { refreshSnapshot: true } : {}) };
}
