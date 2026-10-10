import type { PortfolioHoldingsValuation } from "@/domain/portfolio-valuation";
import { AdrPremiumBadge } from "./adr-premium-badge";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shares = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
export const formatPortfolioUsd = (value: number | null) => value === null ? "—" : usd.format(value);

export function PortfolioValuationPanel({
  ticker,
  valuation,
}: {
  ticker: string;
  valuation: PortfolioHoldingsValuation;
}) {
  return (
    <section className="panel holdings-position-table portfolio-valuation-panel" aria-label={`${ticker} portfolio value`}>
      <div className="panel-heading panel-heading--table">
        <div>
          <span className="eyebrow">Portfolio value · {ticker}</span>
          <h2>{formatPortfolioUsd(valuation.totalMarketValueUsd)}</h2>
          <p className="holdings-method-copy">Net asset value in USD, including cash and short positions. Amounts use the latest available quotes and exchange rates.</p>
        </div>
        <span className="info-chip">Actual holdings</span>
      </div>
      <details key={ticker}>
        <summary>Positions, amounts and shares · {valuation.items.length + valuation.cash.length} lines</summary>
        <p className="holdings-method-copy">Shares below are the instruments held. The analysis table shows underlying exposure through ETF sleeves; its dollar amounts always use net asset value, even when weights exclude cash.</p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Position</th><th>NAV weight</th><th>Value (USD)</th><th>Shares / cash amount</th></tr></thead>
            <tbody>
              {valuation.items.map((item, index) => (
                <tr key={`${item.ticker}-${index}`} className={item.allocationWeight < 0 ? "is-negative" : undefined}>
                  <td><div className="security-cell"><div><strong className="security-ticker-with-premium"><span>{item.ticker}</span><AdrPremiumBadge security={item} /></strong><span>{item.name} · {item.kind === "etf" ? "ETF sleeve" : "Direct security"}</span></div></div></td>
                  <td>{item.allocationWeight.toFixed(2)}%</td>
                  <td>{formatPortfolioUsd(item.currentValueUsd)}</td>
                  <td>{item.quantity === null ? "—" : shares.format(item.quantity)} shares</td>
                </tr>
              ))}
              {valuation.cash.map((cash) => (
                <tr key={cash.currency} className={cash.amount < 0 ? "is-negative" : "is-cash-position"}>
                  <td>{cash.currency} {cash.amount < 0 ? "borrowed cash" : "cash"}</td>
                  <td>{cash.weight === null ? "—" : `${cash.weight.toFixed(2)}%`}</td>
                  <td>{formatPortfolioUsd(cash.valueUsd)}</td>
                  <td>{shares.format(cash.amount)} {cash.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
