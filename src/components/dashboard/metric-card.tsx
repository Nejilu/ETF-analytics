import type { ReactNode } from "react";

export function MetricCard({ label, value, detail, tone = "neutral" }: {
  label: ReactNode;
  value: ReactNode;
  detail: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "left" | "right";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__label">{label}</div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
