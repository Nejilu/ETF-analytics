import assert from "node:assert/strict";
import test from "node:test";

import { parseTradingViewEstimateSeries, parseTradingViewFrames } from "./tradingview-estimates";

test("parses framed TradingView messages", () => {
  const first = JSON.stringify({ m: "one" });
  const second = "~h~123";
  assert.deepEqual(
    parseTradingViewFrames(`~m~${first.length}~m~${first}~m~${second.length}~m~${second}`),
    [first, second],
  );
});

test("selects four historical estimates and four future estimates without using Actual", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    Actual: 1_000 + index,
    Estimate: { average: index + 1, date: 1_700_000_000 + index, est_num: 20 + index },
    FiscalPeriod: `Q${index + 1}`,
    IsReported: index < 6,
  }));
  const result = parseTradingViewEstimateSeries("NASDAQ:TEST", {
    lp: 100,
    currency_code: "USD",
    eps_estimates_fq_h: points,
  });
  assert.deepEqual(result?.points.map((point) => point.estimate), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(result?.points.some((point) => point.estimate >= 1_000), false);
});
