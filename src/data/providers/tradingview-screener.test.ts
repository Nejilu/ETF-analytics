import assert from "node:assert/strict";
import test from "node:test";

import { SOURCE_METRIC_DEFINITIONS } from "@/domain/metrics";
import { parseTradingViewScanResponse } from "./tradingview-screener";

test("maps non-EPS screener fundamentals without deriving earnings metrics", () => {
  const source = Object.fromEntries(SOURCE_METRIC_DEFINITIONS.map((definition, index) => [
    definition.key,
    index + 1,
  ]));
  const result = parseTradingViewScanResponse({
    data: [{
      s: "NASDAQ:MSFT",
      d: ["MSFT", "Microsoft Corporation", "Technology Services", ...Object.values(source)],
    }],
  })[0];
  assert.equal(result.symbol, "NASDAQ:MSFT");
  assert.equal(result.description, "Microsoft Corporation");
  assert.deepEqual(result.values, source);
  assert.equal("pe_ttm" in result.values, false);
  assert.equal("eps_diluted_fq" in result.values, false);
});

test("keeps missing provider values absent", () => {
  const result = parseTradingViewScanResponse({
    data: [{ s: "NYSE:TEST", d: ["TEST", "Test Company", "Industrials"] }],
  })[0];
  assert.deepEqual(result.values, {});
});
