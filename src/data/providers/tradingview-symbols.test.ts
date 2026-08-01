import assert from "node:assert/strict";
import test from "node:test";

import { tradingViewSymbolCandidates } from "./tradingview-symbols";

test("uses the exact iShares listing exchange when it is available", () => {
  assert.deepEqual(tradingViewSymbolCandidates({
    ticker: "AAPL",
    name: "Apple Inc",
    country: "United States",
    exchange: "NASDAQ",
  }), ["NASDAQ:AAPL"]);
});

test("falls back to plausible country exchanges for legacy snapshots", () => {
  assert.deepEqual(tradingViewSymbolCandidates({
    ticker: "AAPL",
    name: "Apple Inc",
    country: "United States",
  }), ["NASDAQ:AAPL", "NYSE:AAPL", "AMEX:AAPL"]);
  assert.deepEqual(tradingViewSymbolCandidates({
    ticker: "005930",
    name: "Samsung Electronics Ltd",
    country: "Korea (South)",
  }), ["KRX:005930", "KOSDAQ:005930"]);
});

test("retains imported ticker disambiguation rules", () => {
  assert.deepEqual(tradingViewSymbolCandidates({
    ticker: "BRKB",
    name: "Berkshire Hathaway Inc Class B",
    country: "United States",
    exchange: "New York Stock Exchange",
  }), ["NYSE:BRK.B"]);
  assert.deepEqual(tradingViewSymbolCandidates({
    ticker: "CEMEXCPO",
    name: "Cemex SAB de CV",
    country: "Mexico",
    exchange: "Bolsa Mexicana de Valores",
  }), ["BMV:CEMEXCPO", "BMV:CEMEX/CPO"]);
});

test("keeps a US depositary receipt on its US listing", () => {
  assert.deepEqual(tradingViewSymbolCandidates({
    ticker: "ASML",
    name: "ASML Holding ADR Representing NV",
    country: "Netherlands",
    exchange: "Euronext Amsterdam",
  }), ["NASDAQ:ASML"]);
});
