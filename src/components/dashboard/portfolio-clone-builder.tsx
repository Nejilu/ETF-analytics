"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogGroup } from "@/domain/etf";
import { SUPPORTED_CASH_CURRENCIES, type PortfolioCashCurrency } from "@/domain/portfolio";
import { validateCloneDraft, type PortfolioCloneResult } from "@/domain/portfolio-clone";
import { EtfSearch } from "./etf-search";

interface SourceRow { id: string; sourceId: string; allocation: string }

export function PortfolioCloneBuilder({ catalog, hasPositions, disabled, onApply, onBusyChange }: {
  catalog: CatalogGroup[];
  hasPositions: boolean;
  disabled: boolean;
  onApply: (result: PortfolioCloneResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [amount, setAmount] = useState("50000");
  const [currency, setCurrency] = useState<PortfolioCashCurrency>("USD");
  const [sources, setSources] = useState<SourceRow[]>([{ id: "first", sourceId: "", allocation: "100" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PortfolioCloneResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const locked = busy || disabled;
  const total = sources.reduce((sum, source) => sum + (Number(source.allocation) || 0), 0);
  const money = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value) : "—";
  const update = (id: string, changes: Partial<SourceRow>) => {
    setSources((current) => current.map((row) => row.id === id ? { ...row, ...changes } : row));
    setResult(null); setError(null);
  };
  const addSource = () => {
    setSources((rows) => {
      if (rows.length === 1 && Number(rows[0].allocation) === 100) return [
        { ...rows[0], allocation: "50" }, { id: crypto.randomUUID(), sourceId: "", allocation: "50" },
      ];
      return [...rows, { id: crypto.randomUUID(), sourceId: "", allocation: String(Math.max(0, 100 - total)) }];
    });
    setResult(null); setError(null);
  };
  const generate = async () => {
    const draft = { amount: Number(amount), currency, sources: sources.map((source) => ({ sourceId: source.sourceId, allocation: Number(source.allocation) })) };
    try { validateCloneDraft(draft); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check your allocation."); return; }
    const request = new AbortController();
    controller.current?.abort(); controller.current = request;
    setBusy(true); onBusyChange(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/v1/portfolio/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), signal: request.signal });
      const payload = await response.json() as { data?: PortfolioCloneResult; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "The allocation could not be cloned.");
      if (!request.signal.aborted) { onApply(payload.data); setResult(payload.data); }
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : "The allocation could not be cloned.");
    } finally {
      if (!request.signal.aborted) { setBusy(false); onBusyChange(false); }
    }
  };

  return <section className="panel portfolio-clone-builder" aria-label="Create portfolio from sources" aria-busy={busy}>
    <div className="panel-heading"><div><span className="eyebrow">Start from an allocation</span><h2>Clone portfolios or ETFs</h2></div><span className="info-chip">Snapshot copy</span></div>
    <p className="portfolio-clone-description">Set your total budget and split it between sources. Their underlying positions are copied into your draft; future source changes will not rebalance this portfolio.</p>
    <fieldset className="portfolio-clone-fields" disabled={locked}>
      <div className="portfolio-clone-budget">
        <label className="field"><span>Portfolio amount</span><input type="number" min="0.01" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setResult(null); }} /></label>
        <label className="field"><span>Portfolio currency</span><select value={currency} onChange={(event) => { setCurrency(event.target.value as PortfolioCashCurrency); setResult(null); }}>{SUPPORTED_CASH_CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select></label>
      </div>
      <div className="portfolio-clone-sources">
        {sources.map((source, index) => <div className="portfolio-clone-source" key={source.id}>
          <EtfSearch catalog={catalog} selectedId={source.sourceId} label={`Source ${index + 1} to clone`} onSelect={(sourceId) => { if (!locked) update(source.id, { sourceId }); }} />
          <label className="field"><span>Allocation {index + 1} (%)</span><input type="number" min="0" max="100" step="any" value={source.allocation} onChange={(event) => update(source.id, { allocation: event.target.value })} /></label>
          <strong className="portfolio-clone-source-amount">{money(Number(amount) * Number(source.allocation) / 100)}</strong>
          <button className="remove-line" type="button" disabled={sources.length === 1} aria-label={`Remove source ${index + 1}`} onClick={() => { setSources((rows) => rows.filter((row) => row.id !== source.id)); setResult(null); }}>×</button>
        </div>)}
      </div>
      <div className="portfolio-clone-actions">
        <button className="secondary-button" type="button" disabled={sources.length >= 10} onClick={addSource}>+ Add source</button>
        <span className={total > 100 ? "negative-position-weight" : ""}>{total.toFixed(2)}% allocated{total <= 100 ? ` · ${money(Number(amount) * (100 - total) / 100)} unallocated cash` : " · exceeds 100%"}</span>
        <button className="primary-button" type="button" onClick={() => void generate()}>{busy ? <><span className="spinner" /> Calculating…</> : hasPositions ? "Replace draft allocation" : "Generate positions"}</button>
      </div>
    </fieldset>
    {busy ? <p className="portfolio-clone-description" role="status">Loading source holdings and market prices. Large allocations may take a moment.</p> : null}
    {error ? <p className="alert alert--error" role="alert">{error}</p> : null}
    {result ? <div className="portfolio-clone-result" role="status"><strong>{result.portfolio.items.length} positions generated · {money(result.amount)}</strong><span>Review the positions below, then save your portfolio.</span>{result.sources.map((source) => <small key={source.sourceId}>{source.ticker} · {source.allocation}% · composition as of {new Date(source.asOf).toLocaleDateString("en-GB")}</small>)}</div> : null}
  </section>;
}
