"use client";

import { useMemo, useState } from "react";

import type { CatalogGroup, EtfShareClass } from "@/domain/etf";

interface EtfSearchProps {
  catalog: CatalogGroup[];
  selectedId: string;
  label: string;
  onSelect: (etfId: string) => void;
}

function normalized(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

function selectedLabel(etf: EtfShareClass | undefined): string {
  return etf ? `${etf.ticker} · ${etf.name}` : "";
}

function wrapperLabel(etf: EtfShareClass): string {
  if (etf.fundType === "portfolio") return "Portfolio ETF";
  if (etf.fundType === "custom") return "Custom ETF";
  if (etf.exposureMultiplier) return `${etf.exposureMultiplier}× daily`;
  if (etf.wrapper === "SYNTHETIC") return "Synthetic UCITS";
  return etf.wrapper === "UCITS" ? "UCITS" : "US";
}

export function EtfSearch({
  catalog,
  selectedId,
  label,
  onSelect,
}: EtfSearchProps) {
  const options = useMemo(
    () =>
      catalog.flatMap((benchmark) =>
        benchmark.variants.map((etf) => ({ benchmark, etf })),
      ),
    [catalog],
  );
  const selected = options.find((option) => option.etf.id === selectedId)?.etf;
  const currentLabel = selectedLabel(selected);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const displayedQuery = query ?? currentLabel;
  const searchTerm = normalized(
    displayedQuery === currentLabel ? "" : displayedQuery,
  );
  const results = useMemo(() => {
    const scored = options
      .filter(({ benchmark, etf }) => {
        if (!searchTerm) return true;
        return [
          etf.ticker,
          etf.name,
          etf.issuer,
          benchmark.name,
          benchmark.provider,
          etf.description,
          etf.exposureMultiplier ? `${etf.exposureMultiplier}x` : undefined,
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalized(value).includes(searchTerm));
      })
      .sort((left, right) => {
        const leftTicker = normalized(left.etf.ticker);
        const rightTicker = normalized(right.etf.ticker);
        const leftScore = leftTicker === searchTerm
          ? 0
          : leftTicker.startsWith(searchTerm)
            ? 1
            : 2;
        const rightScore = rightTicker === searchTerm
          ? 0
          : rightTicker.startsWith(searchTerm)
            ? 1
            : 2;
        return leftScore - rightScore || left.etf.name.localeCompare(right.etf.name);
      });
    return scored.slice(0, 12);
  }, [options, searchTerm]);

  const listboxId = `etf-search-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div
      className="security-search etf-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label className="field">
        <span>{label}</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={displayedQuery}
          placeholder="Ticker, ETF or index"
          autoComplete="off"
          onFocus={(event) => {
            event.currentTarget.select();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
      </label>
      {open ? (
        <div
          className="security-search-results etf-search-results"
          id={listboxId}
          role="listbox"
        >
          {results.length > 0 ? (
            results.map(({ benchmark, etf }) => (
              <button
                type="button"
                role="option"
                aria-selected={etf.id === selectedId}
                className={etf.id === selectedId ? "is-selected" : ""}
                key={etf.id}
                onClick={() => {
                  setQuery(null);
                  setOpen(false);
                  onSelect(etf.id);
                }}
              >
                <strong>{etf.ticker}</strong>
                <span>{etf.name}</span>
                <small>{benchmark.name} · {wrapperLabel(etf)}</small>
              </button>
            ))
          ) : (
            <div className="security-search-message">No matching ETF.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
