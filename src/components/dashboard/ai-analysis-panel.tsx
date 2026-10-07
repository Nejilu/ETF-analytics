"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AI_TEMPLATES, AI_MAX_POSITIONS, AI_POSITION_DEFAULTS, aiPositionLimit, type AiConfiguration, type AiRun, type AiSnapshot, type AiTemplateId } from "@/domain/ai-analysis";
import type { CatalogGroup } from "@/domain/etf";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The analysis request failed.");
  return result.data as T;
}

export function AiAnalysisPanel({ catalog, initialEtfId }: { catalog: CatalogGroup[]; initialEtfId: string }) {
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [target, setTarget] = useState(initialEtfId);
  const [template, setTemplate] = useState<AiTemplateId>("overview");
  const [positionLimit, setPositionLimit] = useState(AI_POSITION_DEFAULTS.overview);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AiRun[]>([]);
  const [run, setRun] = useState<AiRun | null>(null);
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [subscription, setSubscription] = useState(0);
  const requestLock = useRef(false);
  const selectedModel = configuration?.models.find((m) => m.id === model);
  const running = snapshot?.state === "starting" || snapshot?.state === "running";
  const locked = busy || running;
  const questionRequired = Boolean(run) || template === "custom";
  const questionLabel = run ? "Follow-up question" : template === "custom" ? "Your question" : "Additional context (optional)";

  async function refreshConnection(signal?: AbortSignal) {
    try {
      const [config, runs] = await Promise.all([api<AiConfiguration>("/api/v1/ai/config", { signal }), api<AiRun[]>("/api/v1/ai/runs", { signal })]);
      setConfiguration(config); setHistory(runs);
      const preferred = config.models.find((m) => m.id === model) ?? config.models.find((m) => m.isDefault) ?? config.models[0];
      setModel(preferred?.id ?? "");
      setEffort(preferred?.efforts.some((e) => e.id === effort) ? effort : preferred?.defaultEffort ?? "");
      setError("");
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Could not connect to T3."); }
    finally { if (!signal?.aborted) setRefreshing(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    // State updates occur in the asynchronous connection callback.
    const load = async () => {
      const [config, runs] = await Promise.all([api<AiConfiguration>("/api/v1/ai/config", { signal: controller.signal }), api<AiRun[]>("/api/v1/ai/runs", { signal: controller.signal })]);
      if (controller.signal.aborted) return;
      setConfiguration(config); setHistory(runs);
      const preferred = config.models.find((m) => m.isDefault) ?? config.models[0];
      setModel(preferred?.id ?? ""); setEffort(preferred?.defaultEffort ?? "");
    };
    void load().catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not connect to T3."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!run) return;
    const events = new EventSource(`/api/v1/ai/runs/${run.id}/events`);
    events.addEventListener("snapshot", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as AiSnapshot;
      setSnapshot(next);
      if (next.error) setError(next.error);
      if (!["starting", "running"].includes(next.state)) events.close();
    });
    events.addEventListener("analysis-error", (event) => {
      setError(JSON.parse((event as MessageEvent).data).error); events.close();
    });
    // EventSource reconnects after network loss and the server sends the full
    // snapshot again, so text is replaced rather than appended twice.
    events.onerror = () => setError("Connection interrupted. Reconnecting to the analysis…");
    events.onopen = () => setError("");
    return () => events.close();
  }, [run, subscription]);

  function openRun(value: AiRun) {
    setRun(value); setSnapshot(null); setError(""); setQuestion("");
    setTarget(value.request.target.kind === "portfolio" ? "portfolio" : value.request.target.reference);
    setTemplate(value.request.template); setLanguage(value.request.language);
    setPositionLimit(aiPositionLimit(value.request));
    const available = configuration?.models.find((m) => m.id === value.request.model);
    if (available) { setModel(available.id); setEffort(available.efforts.some((e) => e.id === value.request.effort) ? value.request.effort : available.defaultEffort); }
  }

  async function start(refreshSnapshot = false) {
    if (requestLock.current || locked || !selectedModel || (questionRequired && !question.trim())) return;
    requestLock.current = true; setBusy(true); setError("");
    try {
      const value = await api<AiRun>("/api/v1/ai/runs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          target: target === "portfolio" ? { kind: "portfolio" } : { kind: "etf", reference: target }, template, positionLimit, model, effort, language, question, ...(run ? { runId: run.id, refreshSnapshot } : {}),
        }),
      });
      setRun(value); setSnapshot({ run: value, messages: snapshot?.messages ?? [], state: "starting", activities: [] });
      setSubscription((s) => s + 1); setQuestion("");
      setHistory((old) => [value, ...old.filter((r) => r.id !== value.id)].slice(0, 30));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis could not be started.");
      void api<AiRun[]>("/api/v1/ai/runs").then(setHistory).catch(() => {});
    } finally { setBusy(false); requestLock.current = false; }
  }

  async function stop() {
    if (!run || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/ai/runs/${run.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error);
      setSubscription((s) => s + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stop the analysis."); }
    finally { setBusy(false); }
  }

  return (
    <div className="ai-workspace">
      <section className="metrics-hero panel">
        <div><span className="eyebrow">Research with Codex</span><h1>AI analysis</h1><p>Explore your ETF or portfolio using its holdings and research from the web.</p></div>
        <span className={`source-badge${configuration?.connected ? "" : " source-badge--idle"}`} role="status"><i />{refreshing ? "Connecting…" : configuration?.connected ? "Codex connected" : "Not connected"}</span>
      </section>
      {!configuration?.connected ? (
        <section className="panel ai-connection"><strong>Connect your existing Codex account through T3</strong><p>{configuration?.message ?? "Checking the research connection…"}</p><p>The connection is configured on the machine running the application. Your Codex subscription is used for analyses.</p><button type="button" className="secondary-button" onClick={() => { setRefreshing(true); void refreshConnection(); }} disabled={refreshing}>Check connection</button></section>
      ) : null}
      <div className="ai-columns">
        <section className="panel ai-controls" aria-label="Analysis settings">
          <label>Analyse<select aria-label="Analyse" value={target} disabled={Boolean(run) || locked} onChange={(e) => setTarget(e.target.value)}><option value="portfolio">Current portfolio</option>{catalog.map((group) => <optgroup key={group.id} label={group.name}>{group.variants.map((etf) => <option key={etf.id} value={etf.id}>{etf.ticker} · {etf.name}</option>)}</optgroup>)}</select></label>
          <div className="ai-control-row"><label>Model<select aria-label="Model" value={model} disabled={locked || !configuration?.connected} onChange={(e) => { setModel(e.target.value); setEffort(configuration?.models.find((m) => m.id === e.target.value)?.defaultEffort ?? ""); }}>{configuration?.models.length ? configuration.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>) : <option value="">Connect Codex first</option>}</select></label><label>Reasoning effort<select aria-label="Reasoning effort" value={effort} disabled={locked || !selectedModel?.efforts.length} onChange={(e) => setEffort(e.target.value)}>{selectedModel?.efforts.length ? selectedModel.efforts.map((e) => <option key={e.id} value={e.id}>{e.label}</option>) : <option value="">Model default</option>}</select></label></div>
          <label>Response language<select aria-label="Response language" value={language} disabled={locked} onChange={(e) => setLanguage(e.target.value as "fr" | "en")}><option value="fr">Français</option><option value="en">English</option></select></label>
          <fieldset className="ai-templates" disabled={Boolean(run) || locked}><legend>Analysis template</legend>{AI_TEMPLATES.map((t) => <button key={t.id} type="button" aria-pressed={template === t.id} className={`ai-template${template === t.id ? " is-selected" : ""}`} onClick={() => { setTemplate(t.id); setPositionLimit(AI_POSITION_DEFAULTS[t.id]); }}><strong>{t.title}</strong><span>{t.description}</span></button>)}</fieldset>
          <div className="ai-position-budget">
            <label htmlFor="ai-position-limit"><span>Top positions to send <output htmlFor="ai-position-limit">{positionLimit}</output></span></label>
            <input id="ai-position-limit" type="range" min={0} max={AI_MAX_POSITIONS} step={1} value={positionLimit} disabled={locked} aria-describedby="ai-position-limit-help" aria-valuetext={positionLimit === 0 ? "Summary only" : `Up to ${positionLimit} positions`} onChange={(e) => setPositionLimit(Number(e.target.value))} />
            <div className="ai-range-labels"><span>Summary only</span><span>{AI_MAX_POSITIONS}</span></div>
            <p id="ai-position-limit-help" className="ai-footnote">{positionLimit === 0 ? "No individual holdings." : `Up to ${positionLimit} holdings, largest weights first.`} Sector and country totals, concentration and cash always cover the full composition.</p>
            {run && positionLimit !== aiPositionLimit(run.request) ? <p className="ai-footnote">Your next question will include a new snapshot with this position limit.</p> : null}
          </div>
          <label>{questionLabel}<textarea aria-label={questionLabel} required={questionRequired} value={question} maxLength={4000} rows={4} disabled={locked} placeholder={run ? "Ask about this analysis…" : template === "custom" ? "Write exactly what you want Codex to analyse…" : "Your objectives, time horizon, or a specific question…"} onChange={(e) => setQuestion(e.target.value)} /></label>
          <div className="ai-actions"><button type="button" className="primary-button" disabled={locked || !configuration?.connected || !selectedModel || (questionRequired && !question.trim())} onClick={() => void start()}>{busy ? "Please wait…" : run ? "Send follow-up" : "Start analysis"}</button>{running ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void stop()}>Stop</button> : run ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { setRun(null); setSnapshot(null); setQuestion(""); setError(""); }}>New analysis</button> : null}</div>
          {run ? <div className="ai-actions"><button type="button" className="secondary-button" disabled={locked || !configuration?.connected || !selectedModel || !question.trim()} onClick={() => void start(true)}>Send with updated holdings</button></div> : null}
          {run ? <p className="ai-footnote">Follow-ups reuse holdings for 24 hours. Changing the position limit or sending with updated holdings includes a new snapshot.</p> : null}
          <p className="ai-footnote">Each analysis uses your Codex quota. Holdings weights and dates are included; portfolio quantities and account values are excluded.</p>
        </section>
        <section className="panel ai-response" aria-label="Analysis response" aria-busy={locked}>
          <div className="ai-response-header"><h2>{run?.title ?? "Research response"}</h2><span role="status">{busy ? "Preparing…" : running ? "Researching…" : snapshot ? snapshot.state : "Ready"}</span></div>
          {error ? <p className="ai-error" role="alert">{error}</p> : null}
          {!run ? <div className="ai-empty"><span aria-hidden="true">✦</span><h3>Start with an analysis template</h3><p>Codex will use the saved composition and look up recent information, with source links in its response.</p></div> : !snapshot ? <p role="status">Loading conversation…</p> : null}
          {snapshot?.messages.map((message) => <article key={message.id} className={`ai-message ai-message--${message.role}`}><strong>{message.role === "user" ? "You" : "Codex"}</strong>{message.role === "assistant" ? <div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span> }}>{message.text}</ReactMarkdown></div> : <p>{message.text}</p>}</article>)}
          {running && snapshot?.activities.length ? <details className="ai-activity"><summary>Research activity</summary><ul>{snapshot.activities.map((activity, index) => <li key={`${index}:${activity}`}>{activity}</li>)}</ul></details> : null}
        </section>
      </div>
      {history.length ? <section className="panel ai-history"><h2>Recent analyses</h2><div>{history.map((entry) => <button key={entry.id} type="button" className="ai-history-item" aria-pressed={entry.id === run?.id} disabled={locked} onClick={() => openRun(entry)}><strong>{entry.title}</strong><span>{AI_TEMPLATES.find((t) => t.id === entry.request.template)?.title} · {new Date(entry.createdAt).toLocaleDateString()}</span></button>)}</div></section> : null}
    </div>
  );
}
