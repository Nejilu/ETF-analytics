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

import type {
  CatalogGroup,
  ComparisonResult,
  EtfShareClass,
  SleevePosition,
} from "@/domain/etf";

interface ComparisonWorkbenchProps {
  catalog: CatalogGroup[];
  initialComparison: ComparisonResult;
}

type SelectionSide = "left" | "right";

const COLORS = {
  left: "#7567e8",
  overlap: "#24c6a1",
  right: "#eb785f",
  track: "#e7e9ee",
};

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits).replace(".", ",")} %`;
}

function formatDate(value: string) {
  const date = value.slice(0, 10).split("-");
  return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : value;
}

function wrapperLabel(etf: EtfShareClass) {
  return etf.wrapper === "UCITS" ? "UCITS" : "US";
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
          <span>Indice sous-jacent</span>
          <select
            aria-label={`Indice de l’ETF ${side === "left" ? "A" : "B"}`}
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
          <span>Part / enveloppe</span>
          <select
            aria-label={`Part de l’ETF ${side === "left" ? "A" : "B"}`}
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
          <p>
            {etf.domicile} · {etf.distributionPolicy === "Accumulating" ? "Capitalisant" : "Distribuant"} · TER{" "}
            {formatPercent(etf.ter, 2)}
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
    { name: "Chevauchement", value: comparison.overlapWeight },
    { name: "Différentiel", value: 100 - comparison.overlapWeight },
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
              border: "1px solid #e7e9ee",
              borderRadius: 12,
              boxShadow: "0 12px 30px rgba(29, 34, 44, .12)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center" aria-hidden="true">
        <strong>{formatPercent(comparison.overlapWeight, 0)}</strong>
        <span>en commun</span>
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
          <span>{formatPercent(comparison.leftActiveWeight)} actif</span>
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
          <span>{formatPercent(comparison.rightActiveWeight)} actif</span>
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
        <span><i className="legend-dot legend-dot--left" />Actif {comparison.left.etf.ticker}</span>
        <span><i className="legend-dot legend-dot--overlap" />Overlap</span>
        <span><i className="legend-dot legend-dot--right" />Actif {comparison.right.etf.ticker}</span>
      </div>
    </div>
  );
}

function SectorChart({ comparison }: { comparison: ComparisonResult }) {
  const data = comparison.sectorComparison
    .filter((sector) => sector.sector !== "Autres")
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
        <CartesianGrid horizontal={false} stroke="#eceef2" />
        <XAxis
          type="number"
          tickFormatter={(value) => `${value}%`}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#8b909d", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="shortSector"
          width={118}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#555b68", fontSize: 11 }}
        />
        <Tooltip
          formatter={(value) => formatPercent(Number(value))}
          cursor={{ fill: "#f6f7f9" }}
          contentStyle={{
            border: "1px solid #e7e9ee",
            borderRadius: 12,
            boxShadow: "0 12px 30px rgba(29, 34, 44, .12)",
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

function PositionTable({ comparison }: { comparison: ComparisonResult }) {
  const [filter, setFilter] = useState<"active" | "overlap">("active");
  const rows = useMemo(() => {
    const filtered = comparison.positions.filter((position) =>
      filter === "active"
        ? position.leftActiveWeight > 0 || position.rightActiveWeight > 0
        : position.overlapWeight > 0,
    );
    return filtered
      .sort((a, b) =>
        filter === "active"
          ? Math.max(b.leftActiveWeight, b.rightActiveWeight) -
            Math.max(a.leftActiveWeight, a.rightActiveWeight)
          : b.overlapWeight - a.overlapWeight,
      )
      .slice(0, 10);
  }, [comparison, filter]);

  return (
    <section className="panel positions-panel">
      <div className="panel-heading panel-heading--table">
        <div>
          <span className="eyebrow">Lecture par titre</span>
          <h2>{filter === "active" ? "Principaux écarts actifs" : "Principales positions communes"}</h2>
        </div>
        <div className="segmented-control" aria-label="Filtrer les positions">
          <button
            type="button"
            className={filter === "active" ? "is-active" : ""}
            onClick={() => setFilter("active")}
          >
            Actif
          </button>
          <button
            type="button"
            className={filter === "overlap" ? "is-active" : ""}
            onClick={() => setFilter("overlap")}
          >
            Commun
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Titre</th>
              <th>{comparison.left.etf.ticker}</th>
              <th>Overlap</th>
              <th>{comparison.right.etf.ticker}</th>
              <th>Lecture</th>
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
      ? `Surpondéré ${leftTicker}`
      : position.rightActiveWeight > position.leftActiveWeight
        ? `Surpondéré ${rightTicker}`
        : "Poids aligné";

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

export function ComparisonWorkbench({
  catalog,
  initialComparison,
}: ComparisonWorkbenchProps) {
  const [leftBenchmark, setLeftBenchmark] = useState("sp-500");
  const [rightBenchmark, setRightBenchmark] = useState("msci-world");
  const [leftTicker, setLeftTicker] = useState("IVV");
  const [rightTicker, setRightTicker] = useState("SWDA");
  const [comparison, setComparison] =
    useState<ComparisonResult>(initialComparison);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBenchmarkChange = (side: SelectionSide, benchmarkId: string) => {
    const benchmark = catalog.find((item) => item.id === benchmarkId);
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

  const compare = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/compare?left=${encodeURIComponent(leftTicker)}&right=${encodeURIComponent(rightTicker)}`,
      );
      const payload = (await response.json()) as {
        data?: ComparisonResult;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "La comparaison n’a pas pu être chargée.");
      }
      setComparison(payload.data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Une erreur inattendue est survenue.",
      );
    } finally {
      setLoading(false);
    }
  };

  const usesFallback =
    comparison.left.sourceStatus === "fallback" ||
    comparison.right.sourceStatus === "fallback";

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
        <nav className="main-nav" aria-label="Navigation principale">
          <a className="nav-item nav-item--active" href="#comparateur">
            <span className="nav-icon">↔</span>
            Comparateur
          </a>
          <a className="nav-item" href="#positions">
            <span className="nav-icon">◎</span>
            Holdings
          </a>
          <span className="nav-caption">Prochains panneaux</span>
          <button className="nav-item nav-item--disabled" type="button">
            <span className="nav-icon">⌁</span>
            Expositions
            <small>Bientôt</small>
          </button>
          <button className="nav-item nav-item--disabled" type="button">
            <span className="nav-icon">⌗</span>
            Métriques
            <small>Bientôt</small>
          </button>
        </nav>
        <div className="sidebar-card">
          <span className="live-pulse" />
          <strong>Sources iShares</strong>
          <p>Holdings mis en cache pendant 24 heures.</p>
        </div>
        <div className="sidebar-footer">
          <span>JL</span>
          <div>
            <strong>Espace recherche</strong>
            <small>Version 0.1</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Analyse <span>/</span> Comparateur ETF
          </div>
          <div className="topbar-actions">
            <span className={`source-badge ${usesFallback ? "source-badge--demo" : ""}`}>
              <i />
              {usesFallback ? "Aperçu démo" : "Données en ligne"}
            </span>
            <button className="icon-button" type="button" aria-label="Aide">
              ?
            </button>
          </div>
        </header>

        <div className="workspace">
          <section className="hero" id="comparateur">
            <div>
              <span className="eyebrow">Analyse look-through</span>
              <h1>Comparez ce que vos ETF détiennent vraiment.</h1>
              <p>
                Sélectionnez deux indices et leurs parts iShares pour isoler
                le portefeuille commun et les paris réellement actifs.
              </p>
            </div>
            <div className="hero-note">
              <span>Dernier calcul</span>
              <strong>{formatDate(comparison.calculatedAt)}</strong>
              <small>Cache source · {comparison.cacheTtlHours} h</small>
            </div>
          </section>

          <section className="comparison-builder">
            <FundSelector
              side="left"
              benchmarkId={leftBenchmark}
              ticker={leftTicker}
              catalog={catalog}
              onBenchmarkChange={onBenchmarkChange}
              onTickerChange={(_, value) => setLeftTicker(value)}
            />
            <div className="versus" aria-hidden="true"><span>VS</span></div>
            <FundSelector
              side="right"
              benchmarkId={rightBenchmark}
              ticker={rightTicker}
              catalog={catalog}
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
                {loading ? <span className="spinner" /> : <span>Actualiser la comparaison</span>}
                {!loading && <b aria-hidden="true">→</b>}
              </button>
              <small>
                {comparison.left.etf.ticker} au {formatDate(comparison.left.asOf)} ·{" "}
                {comparison.right.etf.ticker} au {formatDate(comparison.right.asOf)}
              </small>
            </div>
          </section>

          {error && <div className="alert alert--error">{error}</div>}
          {comparison.warnings.length > 0 && (
            <div className="alert">
              <strong>Aperçu de démonstration.</strong> Les sources officielles
              seront retentées lors de la prochaine actualisation serveur.
            </div>
          )}

          <section className="metric-grid" aria-label="Indicateurs de comparaison">
            <MetricCard
              label="Chevauchement pondéré"
              value={formatPercent(comparison.overlapWeight)}
              detail={`${comparison.sharedPositionsCount} lignes partagées`}
              tone="positive"
            />
            <MetricCard
              label={`Sleeve active ${comparison.left.etf.ticker}`}
              value={formatPercent(comparison.leftActiveWeight)}
              detail={`Top 10 = ${formatPercent(comparison.left.top10Concentration)}`}
              tone="left"
            />
            <MetricCard
              label={`Sleeve active ${comparison.right.etf.ticker}`}
              value={formatPercent(comparison.rightActiveWeight)}
              detail={`Top 10 = ${formatPercent(comparison.right.top10Concentration)}`}
              tone="right"
            />
            <MetricCard
              label="Univers analysé"
              value={`${comparison.left.holdingsCount} / ${comparison.right.holdingsCount}`}
              detail="positions dans chaque ETF"
            />
          </section>

          <section className="analysis-grid">
            <article className="panel overlap-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Décomposition des sleeves</span>
                  <h2>Commun vs actif</h2>
                </div>
                <span className="info-chip">Poids normalisés</span>
              </div>
              <div className="overlap-layout">
                <OverlapDonut comparison={comparison} />
                <div className="overlap-copy">
                  <strong>
                    {comparison.overlapWeight >= 75
                      ? "Deux expositions très proches"
                      : comparison.overlapWeight >= 45
                        ? "Un noyau commun significatif"
                        : "Deux moteurs de performance distincts"}
                  </strong>
                  <p>
                    L’overlap additionne le poids minimal de chaque titre
                    commun. Le solde de chaque portefeuille constitue sa sleeve
                    active.
                  </p>
                  <SleeveBars comparison={comparison} />
                </div>
              </div>
            </article>

            <article className="panel sector-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Allocation</span>
                  <h2>Écart sectoriel</h2>
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
            <PositionTable comparison={comparison} />
          </div>

          <footer className="disclaimer">
            <span>IndexLens</span>
            Données indicatives issues d’iShares lorsque disponibles. Les
            holdings peuvent évoluer sans préavis. Ceci ne constitue pas un
            conseil en investissement.
          </footer>
        </div>
      </main>
    </div>
  );
}
