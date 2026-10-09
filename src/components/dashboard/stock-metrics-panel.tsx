"use client";

import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConsensusHorizon } from "@/domain/metrics";
import type { StockMetricsResult } from "@/domain/stock-metrics";
import { ManualRefreshButton } from "./manual-refresh-button";
import {
  CONSENSUS_OPTIONS, METRIC_GROUPS, SOURCE_WARNING_LABELS,
  formatCaptureWindow, formatDate, formatDateTime, formatMetric, formatNumber,
} from "./metrics-presentation";

interface StockSearchResult {
  securityId: string;
  ticker: string;
  name: string;
  sector: string;
  country: string;
}

function StockMetricGroups({ result }: { result: StockMetricsResult }) {
  return (
    <section className="metrics-groups-panel panel" aria-label="Stock fundamentals">
      <div className="metrics-feature-heading">
        <div><span className="eyebrow">Company fundamentals</span><h2>Valuation, quality, growth and risk</h2></div>
        <p>Direct company observations. Missing values appear as —.</p>
      </div>
      <div className="metrics-group-grid">
        {METRIC_GROUPS.map((group) => {
          const keys = group.id === "consensus-valuation"
            ? result.definitions.filter((definition) => definition.tradingViewColumn === null).map((definition) => definition.key)
            : group.keys;
          return (
            <article className="metrics-group-card" key={group.id} style={{ "--metric-group-color": group.color } as React.CSSProperties}>
              <header className="metrics-group-heading">
                <div><span>{group.id === "size" ? "Company size" : group.title}</span><h3>{result.security.ticker}</h3></div>
                <small>{keys.length}</small>
              </header>
              <div className="metrics-group-scroll">
                <table className="metrics-group-table">
                  <thead><tr><th scope="col">Metric</th><th scope="col">Value / captured</th></tr></thead>
                  <tbody>
                    {keys.map((key) => {
                      const definition = result.definitions.find((item) => item.key === key);
                      if (!definition) return null;
                      const value = result.observations.values[key];
                      const captured = result.observations.capturedAtByKey?.[key];
                      return <tr key={key}>
                        <th scope="row">{definition.shortName}</th>
                        <td><strong>{formatMetric(value ?? null, definition)}</strong><small>{value === undefined ? "Unavailable" : captured ? formatDate(captured) : "Capture date unavailable"}</small></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <footer>{group.id === "consensus-valuation" ? "Current price / quarterly EPS consensus · 4Q rolling" : "TradingView Screener · company observation"}</footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StockConsensus({ result }: { result: StockMetricsResult }) {
  const [horizon, setHorizon] = useState<ConsensusHorizon>("4q");
  const option = CONSENSUS_OPTIONS.find((item) => item.horizon === horizon)!;
  const series = result.observations.estimateSeries;
  const consensus = result.consensusWindows[horizon];
  const valuationPath = option.stages.map((stage, index) => ({ stage, pe: consensus?.pePath[index] ?? null }));
  const startingPe = consensus?.pePath[4 - (consensus?.quarters ?? 4)] ?? null;
  const forwardPe = consensus?.pePath[4] ?? null;
  if (!series) return (
    <section className="metrics-empty panel"><span>∿</span><div><strong>Quarterly consensus unavailable for this stock.</strong><p>Available company fundamentals remain displayed below.</p></div></section>
  );
  return (
    <>
      <section className="metrics-consensus-control panel">
        <div><span className="eyebrow">Consensus EPS calculation</span><strong>P/E roll-down horizon</strong><small>The horizon changes the P/E chart; metric cards use 4Q rolling.</small></div>
        <div className="metrics-consensus-toggle" role="group" aria-label="Stock consensus horizon">
          {CONSENSUS_OPTIONS.map((item) => <button key={item.horizon} type="button" aria-pressed={horizon === item.horizon} onClick={() => setHorizon(item.horizon)}>{item.label}</button>)}
        </div>
      </section>
      <section className="metrics-feature-card panel">
        <div className="metrics-feature-heading"><div><span className="eyebrow">P/E roll-down</span><h2>{result.security.ticker} earnings valuation path</h2></div><p>Current price divided by {option.description}.</p></div>
        <div className="metrics-feature-chart" role="img" aria-label="Stock P/E valuation path, with values summarized below">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={valuationPath} margin={{ top: 18, right: 24, bottom: 5, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" vertical={false} />
              <XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 9 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--faint)", fontSize: 8 }} tickFormatter={(value) => `${value}×`} />
              <Tooltip formatter={(value) => [`${formatNumber(typeof value === "number" ? value : null)}×`, "P/E"]} />
              <Line type="monotone" dataKey="pe" stroke="#6f57d2" strokeWidth={2.2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="metrics-valuation-summary stock-valuation-summary">
          <div><span>Historical → forward P/E</span><strong>{formatNumber(startingPe)}× → {formatNumber(forwardPe)}×</strong></div>
          <div><span>Expected EPS growth</span><strong>{formatNumber(consensus?.growth ?? null)}%</strong></div>
          <div><span>Annualized EPS · {series.currency}</span><strong>{formatNumber(consensus?.historicalAnnualizedEps ?? null, 2)} → {formatNumber(consensus?.forwardAnnualizedEps ?? null, 2)}</strong></div>
        </div>
        <p className="metrics-chart-note">Each point uses the same captured price of {formatNumber(series.price, 2)} {series.currency}. P/E and growth require positive EPS; non-positive EPS remains visible in the quarterly table. Historical quarters show consensus estimates.</p>
      </section>
      <section className="metrics-feature-card panel">
        <div className="metrics-feature-heading"><div><span className="eyebrow">Quarterly EPS estimates</span><h2>Historical and forward consensus</h2></div><p>Four historical quarters and four forward quarters · {series.currency} per share.</p></div>
        <div className="metrics-feature-chart" role="img" aria-label="Quarterly EPS consensus, with all values in the table below">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series.points} margin={{ top: 18, right: 24, bottom: 5, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" vertical={false} />
              <XAxis dataKey="fiscalPeriod" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 9 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--faint)", fontSize: 8 }} />
              <Tooltip formatter={(value) => [`${formatNumber(typeof value === "number" ? value : null, 2)} ${series.currency}`, "EPS consensus"]} />
              <Line type="monotone" dataKey="estimate" stroke="#36a88a" strokeWidth={2.2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="metrics-group-scroll">
          <table className="metrics-group-table stock-estimates-table">
            <thead><tr><th scope="col">Fiscal period</th><th scope="col">Quarter</th><th scope="col">EPS consensus ({series.currency})</th><th scope="col">Analysts</th><th scope="col">Estimate date</th></tr></thead>
            <tbody>{series.points.map((point, index) => <tr key={`${point.fiscalPeriod}-${index}`}><th scope="row">{point.fiscalPeriod}</th><td>{point.isHistorical ? "Historical" : "Forward"}</td><td><strong>{formatNumber(point.estimate, 2)}</strong></td><td>{point.analystCount ?? "—"}</td><td>{point.estimateDate ? formatDate(point.estimateDate) : "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function StockMetricsPanel() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<StockSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockSearchResult | null>(null);
  const [result, setResult] = useState<StockMetricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const selectedLabel = selected ? `${selected.ticker} · ${selected.name}` : "";

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (!open || query.trim().length < 2 || query === selectedLabel) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/securities/search?assetClass=equity&q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const payload = await response.json() as { data?: StockSearchResult[]; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "Stock search unavailable.");
        if (!controller.signal.aborted) { setMatches(payload.data); setSearching(false); }
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setSearchError(requestError instanceof Error ? requestError.message : "Stock search unavailable.");
        setSearching(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, selectedLabel]);

  const selectStock = (stock: StockSearchResult) => {
    requestController.current?.abort();
    requestController.current = null;
    setLoading(false);
    setSelected(stock);
    setQuery(`${stock.ticker} · ${stock.name}`);
    setOpen(false);
    setMatches([]);
    setActiveIndex(-1);
    setSearching(false);
    setResult(null);
    setError(null);
  };

  const analyze = async (forceRefresh = false) => {
    if (!selected) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/metrics/stock?securityId=${encodeURIComponent(selected.securityId)}${forceRefresh ? "&refresh=true" : ""}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as { data?: StockMetricsResult; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Stock metrics unavailable.");
      if (requestController.current === controller) setResult(payload.data);
    } catch (requestError) {
      if (controller.signal.aborted || requestController.current !== controller) return;
      setError(requestError instanceof Error ? requestError.message : "Stock metrics unavailable.");
    } finally {
      if (requestController.current === controller) { requestController.current = null; setLoading(false); }
    }
  };

  return (
    <div className="metrics-overview" aria-busy={loading}>
      <section className="metrics-hero panel">
        <div><span className="eyebrow">Company fundamentals</span><h1>Single stock metrics</h1><p>Explore one company’s valuation, profitability and quarterly earnings consensus.</p></div>
        <ManualRefreshButton disabled={!selected} loading={loading} onRefresh={() => void analyze(true)} />
      </section>
      <section className="metrics-builder panel">
        <div className="security-search stock-metrics-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
          <label className="field"><span>Stock</span><input type="search" role="combobox" aria-expanded={open && query !== selectedLabel && query.trim().length >= 2} aria-controls="stock-metrics-matches" aria-autocomplete="list" aria-activedescendant={open && query !== selectedLabel && activeIndex >= 0 ? `stock-metrics-match-${activeIndex}` : undefined} value={query} placeholder="Ticker or company name" autoComplete="off"
            onFocus={(event) => { event.currentTarget.select(); setOpen(true); }}
            onChange={(event) => {
              requestController.current?.abort(); requestController.current = null;
              setQuery(event.target.value); setOpen(true); setSelected(null); setResult(null); setLoading(false); setError(null);
              setMatches([]); setActiveIndex(-1); setSearchError(null); setSearching(event.target.value.trim().length >= 2);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); }
              if (event.key === "ArrowDown" && matches.length) { event.preventDefault(); setOpen(true); setActiveIndex((index) => (index + 1) % matches.length); }
              if (event.key === "ArrowUp" && matches.length) { event.preventDefault(); setActiveIndex((index) => (index - 1 + matches.length) % matches.length); }
              if (event.key === "Enter" && open && matches[activeIndex]) { event.preventDefault(); selectStock(matches[activeIndex]); }
            }} /></label>
          {open && query !== selectedLabel && query.trim().length >= 2 ? <div className="security-search-results" id="stock-metrics-matches" role="listbox" aria-label="Matching stocks">
            {searching ? <div className="security-search-message" role="status">Searching stocks…</div> : searchError ? <div className="security-search-message" role="alert">{searchError}</div> : matches.length ? matches.map((stock, index) => <button key={stock.securityId} id={`stock-metrics-match-${index}`} type="button" role="option" aria-selected={activeIndex === index} className={activeIndex === index ? "is-selected" : ""} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => selectStock(stock)}><strong>{stock.ticker} · {stock.name}</strong><span>{stock.sector}</span><small>{stock.country}</small></button>) : <div className="security-search-message">No matching stock.</div>}
          </div> : null}
        </div>
        <div className="metrics-builder-action"><small>Search ACWI constituents and supported stocks, then select a company.</small><button className="primary-button" type="button" disabled={!selected || loading} onClick={() => void analyze()}>{loading ? <span className="spinner" /> : "Load stock metrics"}</button></div>
      </section>
      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      {loading ? <section className="metrics-loading panel" role="status"><span className="spinner" /><strong>Loading company fundamentals and consensus…</strong></section> : null}
      {result ? <>
        <section className="metrics-hero panel stock-company-heading"><div><span className="eyebrow">{result.observations.providerSymbol || "TradingView symbol unresolved"}</span><h2>{result.security.ticker} · {result.security.name}</h2><p>{result.security.sector} · {result.security.country} · {result.security.isin ?? result.security.securityId}</p></div>{result.observations.estimateSeries ? <div className="stock-captured-price"><strong>{formatNumber(result.observations.estimateSeries.price, 2)} {result.observations.estimateSeries.currency}</strong><small>Price captured with consensus</small></div> : null}</section>
        <section className="metrics-freshness-panel panel" aria-label="Stock metrics source freshness">
          <div className="metrics-freshness-heading"><span className={`source-status source-status--${result.sourceStatus}`}>{result.sourceStatus}</span><strong>{result.source}</strong><small>{result.cacheTtlHours}h observation cache</small></div>
          <dl><div><dt>Calculated</dt><dd>{formatDateTime(result.calculatedAt)}</dd></div><div><dt>Fundamentals captured</dt><dd>{formatCaptureWindow(result.fundamentalsCaptureWindow)}</dd></div><div><dt>Consensus captured</dt><dd>{formatCaptureWindow(result.estimatesCaptureWindow)}</dd></div></dl>
          {result.sourceWarnings.length ? <details className="metrics-status-warnings" open><summary>Data availability ({result.sourceWarnings.length})</summary><span>{result.sourceWarnings.map((warning) => SOURCE_WARNING_LABELS[warning]).join(" · ")}</span></details> : null}
        </section>
        <section className="metrics-consensus-control panel" aria-label="Next earnings report">
          <div><span className="eyebrow">Earnings calendar</span><strong>Next earnings report</strong><small>Scheduled date from TradingView · may be estimated or revised.</small></div>
          <div className="stock-captured-price">
            <strong>{result.upcomingEarnings.reportDate ? formatDate(result.upcomingEarnings.reportDate) : "Unavailable"}</strong>
            <small>{result.upcomingEarnings.sourceStatus === "unavailable" ? "Date unavailable" : `${result.upcomingEarnings.sourceStatus} · captured ${formatDateTime(result.upcomingEarnings.capturedAt!)}`}{result.upcomingEarnings.exchangeTimezone ? ` · ${result.upcomingEarnings.exchangeTimezone}` : ""}</small>
          </div>
        </section>
        <StockConsensus result={result} />
        <StockMetricGroups result={result} />
      </> : !loading ? <section className="metrics-empty panel"><span>∿</span><div><strong>Select a stock to explore its metrics.</strong><p>Fundamentals and consensus use the same data pipeline as ETF analyses.</p></div></section> : null}
    </div>
  );
}
