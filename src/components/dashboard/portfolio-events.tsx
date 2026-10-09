"use client";

import { useEffect, useMemo, useState } from "react";
import type { PortfolioRecord } from "@/domain/portfolio";
import type { HoldingsAnalysisResult } from "@/domain/holdings-analysis";
import { orderEarningsEvents, PORTFOLIO_EVENT_POSITIONS_LIMIT, PORTFOLIO_EVENT_POSITIONS_MAX, selectHoldingsEventPositions, selectPortfolioEventPositions, type SecurityEarningsEvent } from "@/domain/portfolio-events";

export function PortfolioEvents(props: { portfolio: PortfolioRecord } | { holdings: HoldingsAnalysisResult }) {
  const portfolio = "portfolio" in props ? props.portfolio : undefined;
  const holdings = "holdings" in props ? props.holdings : undefined;
  const [positionsLimit, setPositionsLimit] = useState(PORTFOLIO_EVENT_POSITIONS_LIMIT);
  const positions = useMemo(() => portfolio
    ? selectPortfolioEventPositions(portfolio, positionsLimit)
    : selectHoldingsEventPositions(holdings!.positions, positionsLimit), [portfolio, holdings, positionsLimit]);
  const weightLabel = portfolio || holdings?.portfolioValuation ? "of NAV" : "fund weight";
  const idsKey = JSON.stringify(positions.map((position) => position.securityId));
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const requestKey = `${idsKey}:${attempt}`;
  const [result, setResult] = useState<{ key: string; events: SecurityEarningsEvent[]; error: string | null }>({
    key: "", events: [], error: null,
  });

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("securityId", id));
    void (async () => {
      try {
        const response = await fetch(`/api/v1/portfolio/events?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { data?: SecurityEarningsEvent[]; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "The earnings calendar is unavailable.");
        if (!controller.signal.aborted) setResult({ key: requestKey, events: orderEarningsEvents(payload.data), error: null });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key: requestKey, events: [], error: error instanceof Error ? error.message : "The earnings calendar is unavailable." });
      }
    })();
    return () => controller.abort();
  }, [idsKey, requestKey]);

  const loading = positions.length > 0 && result.key !== requestKey;
  const events = result.key === requestKey ? result.events.filter((event) => event.reportDate !== null) : [];
  const error = result.key === requestKey ? result.error : null;
  const visibleEvents = expanded ? events : events.slice(0, 6);
  const missingDates = positions.length - events.length;

  return (
    <section className="panel portfolio-events-panel" aria-label={holdings ? `${holdings.etf.ticker} earnings calendar` : "Portfolio events"} aria-busy={loading}>
      <div className="panel-heading">
        <div><span className="eyebrow">Upcoming events</span><h2>Earnings calendar</h2></div>
        <select
          className="portfolio-events-limit"
          aria-label="Earnings calendar positions"
          title={`${positions.length} largest equity exposures tracked`}
          value={positionsLimit}
          onChange={(event) => { setPositionsLimit(Number(event.target.value)); setExpanded(false); }}
        >
          <option value={PORTFOLIO_EVENT_POSITIONS_LIMIT}>Top 10</option>
          <option value={PORTFOLIO_EVENT_POSITIONS_MAX}>Top 30</option>
        </select>
      </div>
      <p className="portfolio-events-intro">{holdings ? `Main equity positions in ${holdings.etf.ticker}.` : "Main positions, including stocks held through ETFs."}</p>
      {loading ? <p className="portfolio-events-message" role="status"><span className="spinner" /> Loading upcoming earnings…</p>
        : error ? <div className="portfolio-events-message" role="status"><span>{error}</span><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>
        : visibleEvents.length > 0 ? (
          <ol className="portfolio-event-list" tabIndex={0} aria-label="Upcoming earnings dates">
            {visibleEvents.map((event) => {
              const position = positions.find((candidate) => candidate.securityId === event.securityId);
              const date = new Date(`${event.reportDate}T12:00:00Z`);
              return (
                <li key={event.securityId} className="portfolio-event">
                  <time dateTime={event.reportDate!} className="portfolio-event__date">
                    <strong>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(date)}</strong>
                    <span>{new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date)}</span>
                  </time>
                  <div className="portfolio-event__identity">
                    <strong>{position?.ticker ?? event.ticker}</strong>
                    <span title={position?.name ?? event.name}>{position?.name ?? event.name}</span>
                    <small>{position?.weight.toFixed(2)}% {weightLabel}{event.sourceStatus === "stale" ? " · stale date" : ""}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="portfolio-events-message">{positions.length ? "Upcoming dates are unavailable for these holdings." : "No equity positions to track yet."}</p>}
      {events.length > 6 ? <button className="portfolio-events-more" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer events" : `Show all ${events.length} events`}</button> : null}
      {!loading && !error && positions.length > 0 ? <p className="portfolio-events-footnote">TradingView · Dates may be estimated or revised.{missingDates > 0 ? ` Dates unavailable for ${missingDates} of ${positions.length} holdings.` : ""}</p> : null}
    </section>
  );
}
