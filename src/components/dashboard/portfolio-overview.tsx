"use client";

import { useEffect, useState } from "react";
import type { EtfShareClass } from "@/domain/etf";
import type { LocalEtfDetail, LocalPortfolioEtfDetail } from "@/domain/local-etf";
import type { FxRate } from "@/domain/portfolio";

interface PortfolioOverviewProps {
  portfolios: EtfShareClass[];
  onCreate: () => void;
  onSelect: (id: string, detail?: LocalPortfolioEtfDetail) => void;
}

function PortfolioCard({
  etf,
  onSelect,
  eurRateToUsd,
  eurRateLoading,
}: {
  etf: EtfShareClass;
  onSelect: PortfolioOverviewProps["onSelect"];
  eurRateToUsd: number | null;
  eurRateLoading: boolean;
}) {
  const [detail, setDetail] = useState<LocalPortfolioEtfDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/local-etfs/${encodeURIComponent(etf.id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { data?: LocalEtfDetail; error?: string };
        if (!response.ok || payload.data?.kind !== "portfolio") {
          throw new Error(payload.error ?? "Portfolio summary unavailable.");
        }
        if (!controller.signal.aborted) setDetail(payload.data);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Portfolio summary unavailable.");
        }
      }
    })();
    return () => controller.abort();
  }, [etf.id, attempt]);

  const record = detail?.portfolio;
  const total = record?.analysis?.totalMarketValueUsd ?? (record && !record.priceError
    && record.items.every((item) => item.currentValueUsd !== undefined)
    && record.cashPositions.every((position) => position.valueUsd !== undefined)
    ? record.items.reduce((sum, item) => sum + (item.currentValueUsd ?? 0), 0)
      + record.cashPositions.reduce((sum, position) => sum + (position.valueUsd ?? 0), 0)
    : undefined);

  return (
    <article className="portfolio-card panel">
      <button className="portfolio-card__open" type="button" onClick={() => onSelect(etf.id, detail ?? undefined)}>
        <span className="portfolio-card__heading">
          <span className="portfolio-card__ticker">{etf.ticker}</span>
          <span className="info-chip">{etf.visibility ?? "private"}</span>
        </span>
        <h2>{etf.name}</h2>
        <p className="portfolio-card__description">
          {detail?.editableDescription || "ETF positions, stocks and cash in one portfolio."}
        </p>
        <span className="portfolio-card__value">
          <span>Net asset value · USD</span>
          <strong>{total !== undefined
            ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(total)
            : record || error ? "Unavailable" : "Loading…"}</strong>
          <small className="portfolio-card__euro-value">
            {total !== undefined && eurRateToUsd !== null
              ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(total / eurRateToUsd)} EUR`
              : eurRateLoading || (!record && !error) ? "EUR · Loading…" : "EUR · Unavailable"}
          </small>
        </span>
        <span className="portfolio-card__stats">
          <span><b>{record ? record.items.length : "—"}</b> positions</span>
          <span><b>{record ? record.cashPositions.length : "—"}</b> cash balances</span>
          <span><b>{record?.analysis?.positionsCount ?? "—"}</b> underlying holdings</span>
        </span>
        <span className="portfolio-card__footer">
          <span>{record ? `Updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(record.updatedAt))}` : "Saved portfolio"}</span>
          <b>View portfolio <span aria-hidden="true">↗</span></b>
        </span>
      </button>
      {error ? (
        <div className="portfolio-card__status" role="status">
          <span>{error}</span>
          <button type="button" className="secondary-button" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry</button>
        </div>
      ) : record?.priceError || record?.analysisError ? (
        <p className="portfolio-card__status">Some prices or analysis are unavailable. Open the portfolio for details.</p>
      ) : null}
    </article>
  );
}

export function PortfolioOverview({ portfolios, onCreate, onSelect }: PortfolioOverviewProps) {
  const [eurRate, setEurRate] = useState<{ rateToUsd: number | null; loading: boolean }>({
    rateToUsd: null,
    loading: true,
  });
  const hasPortfolios = portfolios.length > 0;

  useEffect(() => {
    if (!hasPortfolios) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/prices/fx?currency=EUR", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { data?: FxRate };
        const rateToUsd = payload.data?.rateToUsd;
        if (!response.ok || !Number.isFinite(rateToUsd) || !rateToUsd || rateToUsd <= 0) {
          throw new Error("The EUR exchange rate is unavailable.");
        }
        if (!controller.signal.aborted) setEurRate({ rateToUsd, loading: false });
      } catch {
        if (!controller.signal.aborted) setEurRate({ rateToUsd: null, loading: false });
      }
    })();
    return () => controller.abort();
  }, [hasPortfolios]);

  return (
    <div className="portfolio-workspace" id="portfolio">
      <section className="portfolio-overview-heading">
        <div>
          <span className="eyebrow">Your investments</span>
          <h1>Portfolio</h1>
          <p>Explore your saved portfolios, positions and underlying exposure.</p>
        </div>
        <button className="primary-button" type="button" onClick={onCreate}>
          <span aria-hidden="true">＋</span> Create New
        </button>
      </section>
      <div className="portfolio-overview-label">
        <h2>Your portfolios</h2>
        <span>{portfolios.length} saved portfolio{portfolios.length === 1 ? "" : "s"}</span>
      </div>
      {portfolios.length > 0 ? (
        <section className="portfolio-card-grid" aria-label="Saved portfolios">
          {portfolios.map((etf) => <PortfolioCard key={etf.id} etf={etf} onSelect={onSelect} eurRateToUsd={eurRate.rateToUsd} eurRateLoading={eurRate.loading} />)}
        </section>
      ) : (
        <section className="panel portfolio-overview-empty">
          <span className="portfolio-analysis-empty__icon" aria-hidden="true">◈</span>
          <h2>Your first portfolio starts here</h2>
          <p>Create a portfolio to bring your ETF positions, stocks and cash together.</p>
          <button className="secondary-button" type="button" onClick={onCreate}>＋ Create New</button>
        </section>
      )}
    </div>
  );
}
