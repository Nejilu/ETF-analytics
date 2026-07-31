"use client";

import { useEffect, useMemo, useState } from "react";

import type { CatalogGroup, EtfShareClass } from "@/domain/etf";
import type {
  PortfolioAssetKind,
  PortfolioItem,
  PortfolioRecord,
} from "@/domain/portfolio";

interface PortfolioAnalyticsProps {
  catalog: CatalogGroup[];
  onCatalogChanged: () => Promise<void>;
}

interface SecuritySearchResult {
  securityId: string;
  ticker: string;
  name: string;
  sector: string;
  country: string;
}

function formatPercent(value: number, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

function createItemId() {
  return globalThis.crypto?.randomUUID?.() ??
    `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function PortfolioAnalytics({
  catalog,
  onCatalogChanged,
}: PortfolioAnalyticsProps) {
  const sourceCatalog = useMemo(
    () =>
      catalog
        .map((benchmark) => ({
          ...benchmark,
          variants: benchmark.variants.filter(
            (etf) => etf.fundType !== "portfolio",
          ),
        }))
        .filter((benchmark) => benchmark.variants.length > 0),
    [catalog],
  );
  const etfs = useMemo(
    () => sourceCatalog.flatMap((benchmark) => benchmark.variants),
    [sourceCatalog],
  );
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioRecord | null>(null);
  const [kind, setKind] = useState<PortfolioAssetKind>("etf");
  const [selectedEtfId, setSelectedEtfId] = useState(etfs[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SecuritySearchResult[]>([]);
  const [selectedSecurity, setSelectedSecurity] =
    useState<SecuritySearchResult | null>(null);
  const [allocation, setAllocation] = useState("10");
  const [resultFilter, setResultFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingEtf, setSavingEtf] = useState(false);
  const [savedEtf, setSavedEtf] = useState<EtfShareClass | null>(null);
  const [etfTicker, setEtfTicker] = useState("");
  const [etfName, setEtfName] = useState("My Portfolio ETF");
  const [etfDescription, setEtfDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/v1/portfolio", { cache: "no-store" });
        const payload = (await response.json()) as {
          data?: PortfolioRecord;
          error?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "The saved portfolio could not be loaded.");
        }
        if (active) {
          setPortfolio(payload.data);
          setItems(payload.data.items);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The saved portfolio could not be loaded.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      kind !== "security" ||
      query.trim().length < 2 ||
      selectedSecurity
    ) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/v1/securities/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          data?: SecuritySearchResult[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Security search is unavailable.");
        }
        setSearchResults(payload.data ?? []);
      } catch (searchError) {
        if (!controller.signal.aborted) {
          setSearchResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "Security search is unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [kind, query, selectedSecurity]);

  const draftWeight = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.allocationWeight) ? item.allocationWeight : 0),
    0,
  );
  const hasUnsavedChanges =
    JSON.stringify(
      items.map(({ id, kind: itemKind, referenceId, allocationWeight }) => ({
        id,
        kind: itemKind,
        referenceId,
        allocationWeight,
      })),
    ) !==
    JSON.stringify(
      (portfolio?.items ?? []).map(
        ({ id, kind: itemKind, referenceId, allocationWeight }) => ({
          id,
          kind: itemKind,
          referenceId,
          allocationWeight,
        }),
      ),
    );

  const addItem = () => {
    const numericAllocation = Number(allocation);
    if (!Number.isFinite(numericAllocation) || numericAllocation <= 0) {
      setError("Enter an allocation greater than 0%.");
      return;
    }

    const etfSelection =
      kind === "etf"
        ? etfs.find((etf) => etf.id === selectedEtfId)
        : undefined;
    const securitySelection = kind === "security" ? selectedSecurity : null;
    if (!etfSelection && !securitySelection) {
      setError(
        kind === "etf"
          ? "Select an ETF."
          : "Select a security from the ACWI search results.",
      );
      return;
    }

    const referenceId =
      kind === "etf" ? etfSelection!.id : securitySelection!.securityId;
    const ticker =
      kind === "etf" ? etfSelection!.ticker : securitySelection!.ticker;
    const name =
      kind === "etf" ? etfSelection!.name : securitySelection!.name;
    const existing = items.find(
      (item) => item.kind === kind && item.referenceId === referenceId,
    );
    const nextTotal = draftWeight + numericAllocation;
    if (nextTotal > 100.000001) {
      setError(`This line would bring the portfolio to ${formatPercent(nextTotal)}.`);
      return;
    }

    setItems((current) =>
      existing
        ? current.map((item) =>
            item.id === existing.id
              ? {
                  ...item,
                  allocationWeight: item.allocationWeight + numericAllocation,
                }
              : item,
          )
        : [
            ...current,
            {
              id: createItemId(),
              kind,
              referenceId,
              ticker,
              name,
              allocationWeight: numericAllocation,
            },
          ],
    );
    setError(null);
    if (kind === "security") {
      setQuery("");
      setSelectedSecurity(null);
      setSearchResults([]);
    }
  };

  const save = async () => {
    if (draftWeight > 100.000001) {
      setError("Portfolio allocations cannot exceed 100%.");
      return;
    }
    if (items.some((item) => item.allocationWeight <= 0)) {
      setError("Every line must have an allocation greater than 0%.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/portfolio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map(({ id, kind: itemKind, referenceId, allocationWeight }) => ({
            id,
            kind: itemKind,
            referenceId,
            allocationWeight,
          })),
        }),
      });
      const payload = (await response.json()) as {
        data?: PortfolioRecord;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "The portfolio could not be saved.");
      }
      setPortfolio(payload.data);
      setItems(payload.data.items);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The portfolio could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveAsEtf = async () => {
    if (hasUnsavedChanges) {
      setError("Save and analyse the portfolio before creating its ETF.");
      return;
    }
    setSavingEtf(true);
    setSavedEtf(null);
    setError(null);
    try {
      const response = await fetch("/api/v1/portfolio/save-as-etf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: etfTicker,
          name: etfName,
          description: etfDescription,
        }),
      });
      const payload = (await response.json()) as {
        data?: EtfShareClass;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "The portfolio ETF could not be saved.");
      }
      setSavedEtf(payload.data);
      setEtfTicker("");
      await onCatalogChanged();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The portfolio ETF could not be saved.",
      );
    } finally {
      setSavingEtf(false);
    }
  };

  const filteredPositions = useMemo(() => {
    const normalizedFilter = resultFilter.trim().toLocaleUpperCase("en-US");
    return (portfolio?.analysis?.positions ?? []).filter(
      (position) =>
        !normalizedFilter ||
        position.ticker.toLocaleUpperCase("en-US").includes(normalizedFilter) ||
        position.name.toLocaleUpperCase("en-US").includes(normalizedFilter),
    );
  }, [portfolio, resultFilter]);

  if (loading) {
    return (
      <section className="panel portfolio-loading" aria-live="polite">
        <span className="spinner" />
        Loading your saved portfolio…
      </section>
    );
  }

  const analysis = portfolio?.analysis;
  const maxPositionWeight = analysis?.positions[0]?.weight ?? 0;

  return (
    <div className="portfolio-workspace" id="portfolio">
      <section className="portfolio-hero">
        <div>
          <span className="eyebrow">Look-through aggregation</span>
          <h1>Portfolio Analytics</h1>
          <p>
            Combine ETF sleeves and individual ACWI stocks into one synthetic
            portfolio, then see your true security-level ranking.
          </p>
        </div>
        <div className="portfolio-total">
          <span>Draft allocation</span>
          <strong className={draftWeight > 100 ? "is-over" : ""}>
            {formatPercent(draftWeight)}
          </strong>
          <small>{formatPercent(Math.max(0, 100 - draftWeight))} unallocated</small>
        </div>
      </section>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {portfolio?.analysisError ? (
        <div className="alert alert--error">{portfolio.analysisError}</div>
      ) : null}

      <section className="portfolio-builder-grid">
        <article className="panel portfolio-add-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Step 1</span>
              <h2>Add a position</h2>
            </div>
            <span className="info-chip">Max. 50 lines</span>
          </div>

          <div className="asset-kind-tabs" aria-label="Position type">
            <button
              type="button"
              className={kind === "etf" ? "is-active" : ""}
              aria-pressed={kind === "etf"}
              onClick={() => {
                setKind("etf");
                setSearchResults([]);
                setSearching(false);
              }}
            >
              ETF
              <small>Existing Active Shares catalog</small>
            </button>
            <button
              type="button"
              className={kind === "security" ? "is-active" : ""}
              aria-pressed={kind === "security"}
              onClick={() => {
                setKind("security");
                setSearchResults([]);
                setSearching(false);
              }}
            >
              Individual stock
              <small>ACWI security universe</small>
            </button>
          </div>

          {kind === "etf" ? (
            <label className="field portfolio-asset-field">
              <span>ETF</span>
              <select
                value={selectedEtfId}
                onChange={(event) => setSelectedEtfId(event.target.value)}
              >
                {sourceCatalog.map((benchmark) => (
                  <optgroup label={benchmark.name} key={benchmark.id}>
                    {benchmark.variants.map((etf) => (
                      <option value={etf.id} key={etf.id}>
                        {etf.ticker} · {etf.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : (
            <div className="security-search">
              <label className="field">
                <span>Search ACWI constituents</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Ticker or company name"
                  autoComplete="off"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedSecurity(null);
                    setSearchResults([]);
                    setSearching(false);
                  }}
                />
              </label>
              {query.trim().length >= 2 ? (
                <div className="security-search-results" role="listbox">
                  {searching ? (
                    <div className="security-search-message">Searching ACWI…</div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((security) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={
                          selectedSecurity?.securityId === security.securityId
                        }
                        className={
                          selectedSecurity?.securityId === security.securityId
                            ? "is-selected"
                            : ""
                        }
                        key={security.securityId}
                        onClick={() => {
                          setSelectedSecurity(security);
                          setQuery(`${security.ticker} · ${security.name}`);
                        }}
                      >
                        <strong>{security.ticker}</strong>
                        <span>{security.name}</span>
                        <small>{security.sector}</small>
                      </button>
                    ))
                  ) : (
                    <div className="security-search-message">
                      No matching ACWI security.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <div className="portfolio-add-action">
            <label className="field allocation-field">
              <span>Portfolio allocation</span>
              <span className="percent-input">
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={allocation}
                  onChange={(event) => setAllocation(event.target.value)}
                />
                <b>%</b>
              </span>
            </label>
            <button className="secondary-button" type="button" onClick={addItem}>
              Add position
            </button>
          </div>
        </article>

        <article className="panel portfolio-lines-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Step 2</span>
              <h2>Portfolio sleeves</h2>
            </div>
            <span className="info-chip">{items.length} lines</span>
          </div>

          {items.length > 0 ? (
            <div className="portfolio-lines">
              {items.map((item) => (
                <div className="portfolio-line" key={item.id}>
                  <span className={`asset-badge asset-badge--${item.kind}`}>
                    {item.kind === "etf" ? "ETF" : "Stock"}
                  </span>
                  <div className="portfolio-line__identity">
                    <strong>{item.ticker}</strong>
                    <span>{item.name}</span>
                  </div>
                  <span className="percent-input percent-input--compact">
                    <input
                      aria-label={`${item.ticker} allocation`}
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={item.allocationWeight}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setItems((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, allocationWeight: value }
                              : candidate,
                          ),
                        );
                      }}
                    />
                    <b>%</b>
                  </span>
                  <button
                    className="remove-line"
                    type="button"
                    aria-label={`Remove ${item.ticker}`}
                    onClick={() =>
                      setItems((current) =>
                        current.filter((candidate) => candidate.id !== item.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="portfolio-empty-lines">
              Add at least one ETF or stock to build the look-through portfolio.
            </div>
          )}

          <div className="portfolio-save-row">
            <span>
              {hasUnsavedChanges
                ? "Unsaved portfolio changes"
                : portfolio
                  ? "Portfolio saved locally"
                  : "Ready to save"}
            </span>
            <button
              className="primary-button"
              type="button"
              disabled={saving || draftWeight > 100}
              onClick={save}
            >
              {saving ? <span className="spinner" /> : "Save & analyse"}
            </button>
          </div>
        </article>
      </section>

      {analysis ? (
        <>
          <section className="portfolio-metrics" aria-label="Portfolio metrics">
            <article>
              <span>Invested</span>
              <strong>{formatPercent(analysis.allocationWeight)}</strong>
              <small>{formatPercent(analysis.cashWeight)} cash / unallocated</small>
            </article>
            <article>
              <span>Look-through holdings</span>
              <strong>{analysis.positionsCount}</strong>
              <small>after merging duplicate exposures</small>
            </article>
            <article>
              <span>Top 10 concentration</span>
              <strong>{formatPercent(analysis.top10Concentration)}</strong>
              <small>of the total portfolio</small>
            </article>
            <article>
              <span>Portfolio building blocks</span>
              <strong>
                {analysis.etfSleevesCount} + {analysis.directPositionsCount}
              </strong>
              <small>ETF sleeves + direct stocks</small>
            </article>
          </section>

          <section className="panel save-portfolio-etf-panel">
            <div className="save-portfolio-etf-copy">
              <span className="eyebrow">Reusable local instrument</span>
              <h2>Save this portfolio as an ETF</h2>
              <p>
                IndexLens stores the ETF sleeves and direct-stock weights—not a
                frozen holdings list. Its look-through composition is rebuilt
                from the latest persisted source ETF files every time it is
                opened or compared.
              </p>
              <div className="component-definition">
                {items.map((item) => (
                  <span key={item.id}>
                    <b>{formatPercent(item.allocationWeight)}</b> {item.ticker}
                    <small>{item.kind === "etf" ? "ETF sleeve" : "direct stock"}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="save-portfolio-etf-form">
              <div className="saved-etf-fields">
                <label className="field">
                  <span>Local ticker</span>
                  <input
                    value={etfTicker}
                    maxLength={10}
                    placeholder="MYETF"
                    onChange={(event) =>
                      setEtfTicker(event.target.value.toUpperCase())
                    }
                  />
                </label>
                <label className="field">
                  <span>ETF name</span>
                  <input
                    value={etfName}
                    maxLength={80}
                    onChange={(event) => setEtfName(event.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                <span>Investment description (optional)</span>
                <textarea
                  value={etfDescription}
                  maxLength={240}
                  placeholder="Purpose, strategy or investment role…"
                  onChange={(event) => setEtfDescription(event.target.value)}
                />
              </label>
              <div className="save-etf-action">
                <span>
                  {hasUnsavedChanges
                    ? "Save the latest changes first."
                    : draftWeight !== 100
                      ? `Allocate exactly 100% (${formatPercent(draftWeight)} now).`
                      : "Ready for the ETF catalog."}
                </span>
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    savingEtf ||
                    hasUnsavedChanges ||
                    Math.abs(draftWeight - 100) > 0.000001
                  }
                  onClick={saveAsEtf}
                >
                  {savingEtf ? <span className="spinner" /> : "Save as ETF"}
                </button>
              </div>
              {savedEtf ? (
                <div className="saved-etf-success">
                  <strong>{savedEtf.ticker}</strong> is now available in ETF
                  comparison under Saved portfolios.
                </div>
              ) : null}
            </div>
          </section>

          <section className="portfolio-results-grid">
            <article className="panel synthetic-etf-panel">
              <div className="synthetic-etf-heading">
                <div>
                  <span className="eyebrow">Your synthetic ETF</span>
                  <h2>Real portfolio composition</h2>
                </div>
                <label className="result-search">
                  <span className="sr-only">Filter portfolio holdings</span>
                  <input
                    type="search"
                    value={resultFilter}
                    placeholder="Filter holdings"
                    onChange={(event) => setResultFilter(event.target.value)}
                  />
                </label>
              </div>

              <div className="synthetic-ranking">
                <div className="synthetic-ranking__header">
                  <span>#</span>
                  <span>Security</span>
                  <span>Sources</span>
                  <span>Actual weight</span>
                </div>
                {filteredPositions.slice(0, 30).map((position) => {
                  const rank =
                    analysis.positions.findIndex(
                      (candidate) => candidate.securityId === position.securityId,
                    ) + 1;
                  return (
                    <div className="synthetic-ranking__row" key={position.securityId}>
                      <span className="synthetic-rank">{rank}</span>
                      <div className="synthetic-security">
                        <strong>{position.ticker}</strong>
                        <span>{position.name}</span>
                        <i aria-hidden="true">
                          <b
                            style={{
                              width: `${
                                maxPositionWeight > 0
                                  ? (position.weight / maxPositionWeight) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </i>
                      </div>
                      <div className="contribution-list">
                        {position.contributions.slice(0, 3).map((contribution) => (
                          <span key={contribution.itemId}>
                            {contribution.ticker} {formatPercent(contribution.weight)}
                          </span>
                        ))}
                        {position.contributions.length > 3 ? (
                          <small>+{position.contributions.length - 3} more</small>
                        ) : null}
                      </div>
                      <strong className="synthetic-weight">
                        {formatPercent(position.weight)}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </article>

            <aside className="portfolio-side-panels">
              <article className="panel sector-exposure-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Look-through allocation</span>
                    <h2>Sector exposure</h2>
                  </div>
                </div>
                <div className="sector-exposure-list">
                  {analysis.sectors.slice(0, 8).map((sector) => (
                    <div key={sector.sector}>
                      <span>{sector.sector}</span>
                      <strong>{formatPercent(sector.weight)}</strong>
                      <i aria-hidden="true">
                        <b style={{ width: `${Math.min(100, sector.weight)}%` }} />
                      </i>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel portfolio-sources-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Underlying files</span>
                    <h2>ETF sources</h2>
                  </div>
                </div>
                {analysis.sources.length > 0 ? (
                  <div className="portfolio-source-list">
                    {analysis.sources.map((source) => (
                      <div key={source.ticker}>
                        <strong>{source.ticker}</strong>
                        <span>as of {source.asOf}</span>
                        <b>{source.sourceStatus}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="direct-only-note">
                    Direct-stock portfolio. No ETF file is required.
                  </p>
                )}
              </article>
            </aside>
          </section>
        </>
      ) : (
        <section className="panel portfolio-analysis-empty">
          <span className="portfolio-analysis-empty__icon">Σ</span>
          <div>
            <span className="eyebrow">Synthetic ETF output</span>
            <h2>Save the portfolio to calculate its real composition</h2>
            <p>
              ETF holdings will be expanded and merged with direct positions.
              Nothing is estimated when an official source is unavailable.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
