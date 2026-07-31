"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PortfolioAnalytics } from "@/components/dashboard/portfolio-analytics";
import type {
  CatalogGroup,
  ComparisonResult,
  EtfShareClass,
  ImplicitSleeve,
  SleevePosition,
} from "@/domain/etf";

interface ComparisonWorkbenchProps {
  catalog: CatalogGroup[];
}

type SelectionSide = "left" | "right";

const COLORS = {
  left: "var(--left)",
  overlap: "var(--overlap)",
  right: "var(--right)",
  track: "var(--line)",
};

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function formatDate(value: string) {
  const date = value.slice(0, 10).split("-");
  return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : value;
}

function wrapperLabel(etf: EtfShareClass) {
  if (etf.wrapper === "SYNTHETIC") return "Portfolio ETF";
  return etf.wrapper === "UCITS" ? "UCITS" : "US";
}

function ThemeToggle({ mobile = false }: { mobile?: boolean }) {
  const toggleTheme = () => {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    localStorage.setItem("indexlens-theme", nextTheme);
  };

  return (
    <button
      className={`icon-button theme-toggle${mobile ? " theme-toggle--mobile" : ""}`}
      type="button"
      aria-label="Toggle color theme"
      title="Toggle color theme"
      onClick={toggleTheme}
    >
      <span className="theme-icon theme-icon--light" aria-hidden="true">☾</span>
      <span className="theme-icon theme-icon--dark" aria-hidden="true">☀</span>
    </button>
  );
}

function FundSelector({
  side,
  benchmarkId,
  ticker,
  catalog,
  onBenchmarkChange,
  onTickerChange,
}: {
  side: SelectionSide;
  benchmarkId: string;
  ticker: string;
  catalog: CatalogGroup[];
  onBenchmarkChange: (side: SelectionSide, value: string) => void;
  onTickerChange: (side: SelectionSide, value: string) => void;
}) {
  const benchmark =
    catalog.find((item) => item.id === benchmarkId) ?? catalog[0];
  const etf =
    benchmark.variants.find((variant) => variant.ticker === ticker) ??
    benchmark.variants[0];

  return (
    <section className={`fund-selector fund-selector--${side}`}>
      <div className="fund-selector__eyebrow">
        <span className="fund-dot" aria-hidden="true" />
        ETF {side === "left" ? "A" : "B"}
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Underlying index</span>
          <select
            aria-label={`Underlying index for ETF ${side === "left" ? "A" : "B"}`}
            value={benchmarkId}
            onChange={(event) => onBenchmarkChange(side, event.target.value)}
          >
            {catalog.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Share class / wrapper</span>
          <select
            aria-label={`Share class for ETF ${side === "left" ? "A" : "B"}`}
            value={ticker}
            onChange={(event) => onTickerChange(side, event.target.value)}
          >
            {benchmark.variants.map((variant) => (
              <option value={variant.ticker} key={variant.id}>
                {variant.ticker} · {wrapperLabel(variant)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fund-identity">
        <div className="ticker-tile">{etf.ticker}</div>
        <div>
          <strong>{etf.name}</strong>
          <p
            className={etf.fundType === "portfolio" ? "fund-description" : ""}
            title={
              etf.fundType === "portfolio" ? etf.description : undefined
            }
          >
            {etf.fundType === "portfolio"
              ? etf.description ??
                `${etf.domicile} · dynamic look-through composition`
              : `${etf.domicile} · ${etf.distributionPolicy} · TER ${formatPercent(etf.ter, 2)}`}
          </p>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "positive" | "left" | "right";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__label">{label}</div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function OverlapDonut({ comparison }: { comparison: ComparisonResult }) {
  const data = [
    { name: "Overlap", value: comparison.overlapWeight },
    { name: "Difference", value: 100 - comparison.overlapWeight },
  ];

  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={72}
            outerRadius={94}
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            <Cell fill={COLORS.overlap} />
            <Cell fill={COLORS.track} />
          </Pie>
          <Tooltip
            formatter={(value) => formatPercent(Number(value))}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              color: "var(--ink)",
              boxShadow: "var(--shadow)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center" aria-hidden="true">
        <strong>{formatPercent(comparison.overlapWeight, 0)}</strong>
        <span>overlap</span>
      </div>
    </div>
  );
}

function SleeveBars({ comparison }: { comparison: ComparisonResult }) {
  return (
    <div className="sleeve-bars">
      <div className="sleeve-row">
        <div className="sleeve-row__header">
          <strong>{comparison.left.etf.ticker}</strong>
          <span>{formatPercent(comparison.leftActiveWeight)} active</span>
        </div>
        <div className="sleeve-track">
          <span
            className="sleeve-segment sleeve-segment--left"
            style={{ width: `${comparison.leftActiveWeight}%` }}
          />
          <span
            className="sleeve-segment sleeve-segment--overlap"
            style={{ width: `${comparison.overlapWeight}%` }}
          />
        </div>
      </div>
      <div className="sleeve-row">
        <div className="sleeve-row__header">
          <strong>{comparison.right.etf.ticker}</strong>
          <span>{formatPercent(comparison.rightActiveWeight)} active</span>
        </div>
        <div className="sleeve-track">
          <span
            className="sleeve-segment sleeve-segment--right"
            style={{ width: `${comparison.rightActiveWeight}%` }}
          />
          <span
            className="sleeve-segment sleeve-segment--overlap"
            style={{ width: `${comparison.overlapWeight}%` }}
          />
        </div>
      </div>
      <div className="legend">
        <span><i className="legend-dot legend-dot--left" />Active {comparison.left.etf.ticker}</span>
        <span><i className="legend-dot legend-dot--overlap" />Overlap</span>
        <span><i className="legend-dot legend-dot--right" />Active {comparison.right.etf.ticker}</span>
      </div>
    </div>
  );
}

function SectorChart({ comparison }: { comparison: ComparisonResult }) {
  const data = comparison.sectorComparison
    .filter((sector) => sector.sector !== "Other")
    .slice(0, 7)
    .map((sector) => ({
      ...sector,
      shortSector:
        sector.sector.length > 20
          ? `${sector.sector.slice(0, 18)}…`
          : sector.sector,
    }));

  return (
    <ResponsiveContainer width="100%" height={286}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--line)" />
        <XAxis
          type="number"
          tickFormatter={(value) => `${value}%`}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="shortSector"
          width={118}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
        />
        <Tooltip
          formatter={(value) => formatPercent(Number(value))}
          cursor={{ fill: "#f6f7f9" }}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            color: "var(--ink)",
            boxShadow: "var(--shadow)",
          }}
        />
        <Bar
          dataKey="left"
          name={comparison.left.etf.ticker}
          fill={COLORS.left}
          radius={[0, 4, 4, 0]}
          barSize={7}
        />
        <Bar
          dataKey="right"
          name={comparison.right.etf.ticker}
          fill={COLORS.right}
          radius={[0, 4, 4, 0]}
          barSize={7}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

const IMPLICIT_SLEEVE_RANK_LIMIT = 10;

function ImplicitSleeveRanking({
  sleeve,
  side,
  sharedMaxWeight,
}: {
  sleeve: ImplicitSleeve;
  side: SelectionSide;
  sharedMaxWeight: number;
}) {
  const rankedPositions = sleeve.positions.slice(0, IMPLICIT_SLEEVE_RANK_LIMIT);
  const otherWeight = Math.max(0, 100 - sleeve.top10Concentration);

  return (
    <article className={`implicit-sleeve implicit-sleeve--${side}`}>
      <header className="implicit-sleeve__header">
        <div>
          <span className="implicit-sleeve__label">
            {side === "left" ? "ETF A" : "ETF B"} · implicit ETF
          </span>
          <h3>
            {sleeve.sourceTicker} <span>vs {sleeve.relativeToTicker}</span>
          </h3>
        </div>
        <strong>100%</strong>
      </header>

      <div className="implicit-sleeve__stats">
        <span>
          <b>{sleeve.positionsCount}</b>
          active holdings
        </span>
        <span>
          <b>{formatPercent(sleeve.top10Concentration)}</b>
          top 10
        </span>
        <span>
          <b>{formatPercent(sleeve.sourceActiveWeight)}</b>
          source weight
        </span>
      </div>

      {rankedPositions.length > 0 ? (
        <ol className="implicit-ranking">
          {rankedPositions.map((position, index) => (
            <li key={position.securityId}>
              <span className="implicit-ranking__rank">{index + 1}</span>
              <div className="implicit-ranking__security">
                <div>
                  <strong>{position.ticker}</strong>
                  <span>{position.name}</span>
                </div>
                <b>{formatPercent(position.normalizedWeight, 2)}</b>
                <div className="implicit-ranking__track" aria-hidden="true">
                  <span
                    style={{
                      width: `${sharedMaxWeight > 0 ? (position.normalizedWeight / sharedMaxWeight) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="implicit-sleeve__empty">
          No relative overweight remains after removing the shared portfolio.
        </div>
      )}

      <footer className="implicit-sleeve__footer">
        <span>Other active holdings</span>
        <strong>{formatPercent(otherWeight, 2)}</strong>
      </footer>
    </article>
  );
}

function ImplicitSleevesPanel({
  comparison,
}: {
  comparison: ComparisonResult;
}) {
  const leftSleeve = comparison.implicitSleeves.left;
  const rightSleeve = comparison.implicitSleeves.right;
  const sharedMaxWeight = Math.max(
    leftSleeve.positions[0]?.normalizedWeight ?? 0,
    rightSleeve.positions[0]?.normalizedWeight ?? 0,
  );

  return (
    <section className="panel implicit-sleeves-panel">
      <div className="panel-heading implicit-sleeves-heading">
        <div>
          <span className="eyebrow">Relative portfolio construction</span>
          <h2>Implicit active-sleeve ETFs</h2>
        </div>
        <span className="info-chip">Normalised to 100% · shared scale</span>
      </div>
      <p className="implicit-sleeves-intro">
        Each side contains only that ETF&apos;s relative overweights, rescaled
        to 100%. Choosing {comparison.left.etf.ticker} over{" "}
        {comparison.right.etf.ticker} is equivalent to going long the left
        implicit ETF and short the right one at the active-sleeve weight.
      </p>
      <div className="implicit-sleeves-grid">
        <ImplicitSleeveRanking
          sleeve={leftSleeve}
          side="left"
          sharedMaxWeight={sharedMaxWeight}
        />
        <ImplicitSleeveRanking
          sleeve={rightSleeve}
          side="right"
          sharedMaxWeight={sharedMaxWeight}
        />
      </div>
      <div className="implicit-sleeves-formula">
        Normalised weight = security active weight ÷ total active sleeve × 100
      </div>
    </section>
  );
}

function PositionTable({ comparison }: { comparison: ComparisonResult }) {
  const [filter, setFilter] = useState<"active" | "overlap">("active");
  const [activeRankSide, setActiveRankSide] =
    useState<SelectionSide>("left");
  const activeWeightField =
    activeRankSide === "left" ? "leftActiveWeight" : "rightActiveWeight";
  const activeRankTicker =
    activeRankSide === "left"
      ? comparison.left.etf.ticker
      : comparison.right.etf.ticker;

  const rows = useMemo(() => {
    const filtered = comparison.positions.filter((position) =>
      filter === "active"
        ? position[activeWeightField] > 0
        : position.overlapWeight > 0,
    );
    return filtered
      .sort((a, b) =>
        filter === "active"
          ? b[activeWeightField] - a[activeWeightField]
          : b.overlapWeight - a.overlapWeight,
      )
      .slice(0, 10);
  }, [activeWeightField, comparison, filter]);

  return (
    <section className="panel positions-panel">
      <div className="panel-heading panel-heading--table">
        <div>
          <span className="eyebrow">Security-level analysis</span>
          <h2>
            {filter === "active"
              ? `Largest ${activeRankTicker} active weights`
              : "Largest shared positions"}
          </h2>
        </div>
        <div className="table-controls">
          {filter === "active" ? (
            <div className="rank-control">
              <span>Rank active sleeve</span>
              <div className="segmented-control" aria-label="Rank active sleeve by ETF">
                <button
                  type="button"
                  aria-pressed={activeRankSide === "left"}
                  className={activeRankSide === "left" ? "is-active" : ""}
                  onClick={() => setActiveRankSide("left")}
                >
                  {comparison.left.etf.ticker}
                </button>
                <button
                  type="button"
                  aria-pressed={activeRankSide === "right"}
                  className={activeRankSide === "right" ? "is-active" : ""}
                  onClick={() => setActiveRankSide("right")}
                >
                  {comparison.right.etf.ticker}
                </button>
              </div>
            </div>
          ) : null}
          <div className="segmented-control" aria-label="Filter positions">
            <button
              type="button"
              aria-pressed={filter === "active"}
              className={filter === "active" ? "is-active" : ""}
              onClick={() => setFilter("active")}
            >
              Active
            </button>
            <button
              type="button"
              aria-pressed={filter === "overlap"}
              className={filter === "overlap" ? "is-active" : ""}
              onClick={() => setFilter("overlap")}
            >
              Shared
            </button>
          </div>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Security</th>
              <th>{comparison.left.etf.ticker}</th>
              <th>Overlap</th>
              <th>{comparison.right.etf.ticker}</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => (
              <PositionRow
                key={position.securityId}
                position={position}
                leftTicker={comparison.left.etf.ticker}
                rightTicker={comparison.right.etf.ticker}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionRow({
  position,
  leftTicker,
  rightTicker,
}: {
  position: SleevePosition;
  leftTicker: string;
  rightTicker: string;
}) {
  const dominant =
    position.leftActiveWeight > position.rightActiveWeight
      ? `Overweight ${leftTicker}`
      : position.rightActiveWeight > position.leftActiveWeight
        ? `Overweight ${rightTicker}`
        : "Aligned weight";

  return (
    <tr>
      <td>
        <div className="security-cell">
          <span className="security-avatar">{position.ticker.slice(0, 2)}</span>
          <div>
            <strong>{position.ticker}</strong>
            <span>{position.name}</span>
          </div>
        </div>
      </td>
      <td>{formatPercent(position.leftWeight, 2)}</td>
      <td>
        <span className="overlap-pill">
          {formatPercent(position.overlapWeight, 2)}
        </span>
      </td>
      <td>{formatPercent(position.rightWeight, 2)}</td>
      <td><span className="reading">{dominant}</span></td>
    </tr>
  );
}

function DataUnavailableState({
  leftTicker,
  rightTicker,
  hasError,
  unavailable,
}: {
  leftTicker: string;
  rightTicker: string;
  hasError: boolean;
  unavailable: string[];
}) {
  const isUnavailable = (ticker: string) =>
    hasError && (unavailable.length === 0 || unavailable.includes(ticker));

  return (
    <section className={`panel no-data-panel ${hasError ? "no-data-panel--error" : ""}`}>
      <div className="no-data-icon" aria-hidden="true">{hasError ? "!" : "↻"}</div>
      <div className="no-data-copy">
        <span className="eyebrow">
          {hasError ? "Source unavailable" : "On-demand data"}
        </span>
        <h2>
          {hasError
            ? "No substitute figures are shown."
            : "Load official holdings to begin."}
        </h2>
        <p>
          {hasError
            ? "The comparison remains empty until the required iShares files are available."
            : "IndexLens fetches data directly from iShares and caches each response for 24 hours."}
        </p>
      </div>
      <div className="availability-grid">
        {[leftTicker, rightTicker].map((ticker) => (
          <div className="availability-card" key={ticker}>
            <strong>{ticker}</strong>
            <span>Holdings count</span>
            <b>{isUnavailable(ticker) ? "Unavailable" : "Not loaded"}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ComparisonWorkbench({
  catalog,
}: ComparisonWorkbenchProps) {
  const [availableCatalog, setAvailableCatalog] = useState(catalog);
  const [workspaceView, setWorkspaceView] = useState<"compare" | "portfolio">(
    "compare",
  );
  const [leftBenchmark, setLeftBenchmark] = useState("sp-500");
  const [rightBenchmark, setRightBenchmark] = useState("msci-world");
  const [leftTicker, setLeftTicker] = useState("IVV");
  const [rightTicker, setRightTicker] = useState("SWDA");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);

  const onBenchmarkChange = (side: SelectionSide, benchmarkId: string) => {
    const benchmark = availableCatalog.find((item) => item.id === benchmarkId);
    if (!benchmark) return;
    const preferred =
      side === "right"
        ? benchmark.variants.find((variant) => variant.wrapper === "UCITS")
        : benchmark.variants.find((variant) => variant.wrapper !== "UCITS");
    if (side === "left") {
      setLeftBenchmark(benchmarkId);
      setLeftTicker((preferred ?? benchmark.variants[0]).ticker);
    } else {
      setRightBenchmark(benchmarkId);
      setRightTicker((preferred ?? benchmark.variants[0]).ticker);
    }
  };

  const refreshCatalog = async () => {
    const response = await fetch("/api/v1/catalog", { cache: "no-store" });
    const payload = (await response.json()) as {
      data?: CatalogGroup[];
      error?: string;
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.error ?? "The ETF catalog could not be refreshed.");
    }
    setAvailableCatalog(payload.data);
  };

  const compare = async () => {
    setLoading(true);
    setError(null);
    setUnavailable([]);
    setComparison(null);
    try {
      const response = await fetch(
        `/api/v1/compare?left=${encodeURIComponent(leftTicker)}&right=${encodeURIComponent(rightTicker)}`,
      );
      const payload = (await response.json()) as {
        data?: ComparisonResult;
        error?: string;
        unavailable?: string[];
      };
      if (!response.ok || !payload.data) {
        setUnavailable(payload.unavailable ?? []);
        setError(
          payload.error ??
            "iShares data is unavailable. No figures are shown.",
        );
        return;
      }
      setComparison(payload.data);
    } catch (requestError) {
      setUnavailable([leftTicker, rightTicker]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>IndexLens</span>
        </div>
        <ThemeToggle mobile />
        <nav className="main-nav" aria-label="Primary navigation">
          <button
            className={`nav-item${workspaceView === "compare" ? " nav-item--active" : ""}`}
            type="button"
            aria-pressed={workspaceView === "compare"}
            onClick={() => setWorkspaceView("compare")}
          >
            <span className="nav-icon">↔</span>
            Compare
          </button>
          <button
            className={`nav-item${workspaceView === "portfolio" ? " nav-item--active" : ""}`}
            type="button"
            aria-pressed={workspaceView === "portfolio"}
            onClick={() => setWorkspaceView("portfolio")}
          >
            <span className="nav-icon">Σ</span>
            Portfolio
          </button>
          <a
            className="nav-item"
            href="#positions"
            onClick={() => setWorkspaceView("compare")}
          >
            <span className="nav-icon">◎</span>
            Holdings
          </a>
          <span className="nav-caption">Research modules</span>
          <button className="nav-item nav-item--disabled" type="button">
            <span className="nav-icon">⌁</span>
            Exposures
            <small>Soon</small>
          </button>
          <button className="nav-item nav-item--disabled" type="button">
            <span className="nav-icon">⌗</span>
            Metrics
            <small>Soon</small>
          </button>
        </nav>
        <div className="sidebar-card">
          <span className="live-pulse" />
          <strong>iShares sources</strong>
          <p>Official holdings persisted locally and refreshed every 24 hours.</p>
        </div>
        <div className="sidebar-footer">
          <span>JL</span>
          <div>
            <strong>Research workspace</strong>
            <small>Version 0.1</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Analysis <span>/</span>{" "}
            {workspaceView === "compare"
              ? "ETF comparison"
              : "Portfolio analytics"}
          </div>
          <div className="topbar-actions">
            <span
              className={`source-badge ${
                workspaceView === "portfolio"
                  ? ""
                  : error
                    ? "source-badge--error"
                    : comparison
                      ? ""
                      : "source-badge--idle"
              }`}
            >
              <i />
              {workspaceView === "portfolio"
                ? "Local portfolio"
                : error
                  ? "Unavailable"
                  : comparison
                    ? "Live data"
                    : "Not loaded"}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <div className="workspace">
          <div className="mobile-workspace-switch" aria-label="Analysis module">
            <button
              type="button"
              className={workspaceView === "compare" ? "is-active" : ""}
              onClick={() => setWorkspaceView("compare")}
            >
              ETF comparison
            </button>
            <button
              type="button"
              className={workspaceView === "portfolio" ? "is-active" : ""}
              onClick={() => setWorkspaceView("portfolio")}
            >
              Portfolio
            </button>
          </div>
          {workspaceView === "compare" ? (
            <>
          <section className="comparison-builder" id="comparison">
            <FundSelector
              side="left"
              benchmarkId={leftBenchmark}
              ticker={leftTicker}
              catalog={availableCatalog}
              onBenchmarkChange={onBenchmarkChange}
              onTickerChange={(_, value) => setLeftTicker(value)}
            />
            <div className="versus" aria-hidden="true"><span>VS</span></div>
            <FundSelector
              side="right"
              benchmarkId={rightBenchmark}
              ticker={rightTicker}
              catalog={availableCatalog}
              onBenchmarkChange={onBenchmarkChange}
              onTickerChange={(_, value) => setRightTicker(value)}
            />
            <div className="builder-action">
              <button
                className="primary-button"
                type="button"
                onClick={compare}
                disabled={loading}
              >
                {loading ? <span className="spinner" /> : <span>Run comparison</span>}
                {!loading && <b aria-hidden="true">→</b>}
              </button>
              <small>
                {comparison
                  ? `${comparison.left.etf.ticker} as of ${formatDate(comparison.left.asOf)} · ${comparison.right.etf.ticker} as of ${formatDate(comparison.right.asOf)} · ${comparison.cacheTtlHours}h cache`
                  : "Direct load from official iShares files · 24h cache"}
              </small>
            </div>
          </section>

          {error && <div className="alert alert--error">{error}</div>}
          {comparison ? (
            <>
              <section className="metric-grid" aria-label="Comparison metrics">
                <MetricCard
                  label="Weighted overlap"
                  value={formatPercent(comparison.overlapWeight)}
                  detail={`${comparison.sharedPositionsCount} shared securities`}
                  tone="positive"
                />
                <MetricCard
                  label={`${comparison.left.etf.ticker} active sleeve`}
                  value={formatPercent(comparison.leftActiveWeight)}
                  detail={`Top 10 = ${formatPercent(comparison.left.top10Concentration)}`}
                  tone="left"
                />
                <MetricCard
                  label={`${comparison.right.etf.ticker} active sleeve`}
                  value={formatPercent(comparison.rightActiveWeight)}
                  detail={`Top 10 = ${formatPercent(comparison.right.top10Concentration)}`}
                  tone="right"
                />
                <MetricCard
                  label="Holdings universe"
                  value={`${comparison.left.holdingsCount} / ${comparison.right.holdingsCount}`}
                  detail="positions in each ETF"
                />
              </section>

              <section className="analysis-grid">
                <article className="panel overlap-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">Sleeve decomposition</span>
                      <h2>Overlap vs active</h2>
                    </div>
                    <span className="info-chip">Normalised weights</span>
                  </div>
                  <div className="overlap-layout">
                    <OverlapDonut comparison={comparison} />
                    <div className="overlap-copy">
                      <strong>
                        {comparison.overlapWeight >= 75
                          ? "Closely aligned exposures"
                          : comparison.overlapWeight >= 45
                            ? "Material shared core"
                            : "Distinct exposure profiles"}
                      </strong>
                      <p>
                        Overlap is the sum of the lower weight for every shared
                        security. Each portfolio&apos;s residual weight forms its
                        active sleeve.
                      </p>
                      <SleeveBars comparison={comparison} />
                    </div>
                  </div>
                </article>

                <article className="panel sector-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">Allocation</span>
                      <h2>Sector comparison</h2>
                    </div>
                    <div className="mini-legend">
                      <span><i style={{ background: COLORS.left }} />{comparison.left.etf.ticker}</span>
                      <span><i style={{ background: COLORS.right }} />{comparison.right.etf.ticker}</span>
                    </div>
                  </div>
                  <SectorChart comparison={comparison} />
                </article>
              </section>

              <div id="positions">
                <ImplicitSleevesPanel comparison={comparison} />
                <PositionTable comparison={comparison} />
              </div>
            </>
          ) : (
            <DataUnavailableState
              leftTicker={leftTicker}
              rightTicker={rightTicker}
              hasError={Boolean(error)}
              unavailable={unavailable}
            />
          )}
            </>
          ) : (
            <PortfolioAnalytics
              catalog={availableCatalog}
              onCatalogChanged={refreshCatalog}
            />
          )}

          <footer className="disclaimer">
            <span>IndexLens</span>
            Indicative data sourced from iShares when available. Holdings may
            change without notice. This is not investment advice.
          </footer>
        </div>
      </main>
    </div>
  );
}
