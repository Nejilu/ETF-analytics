import assert from "node:assert/strict";
import test from "node:test";

import { holdingsRefreshCacheKey } from "./holdings-cache";

test("separates in-flight holdings refreshes by database and canonical ETF", () => {
  assert.equal(
    holdingsRefreshCacheKey("/tmp/one.sqlite", "ivv-us", "etf-ivv"),
    "/tmp/one.sqlite::etf-ivv",
  );
  assert.notEqual(
    holdingsRefreshCacheKey("/tmp/one.sqlite", "ivv-us", "etf-ivv"),
    holdingsRefreshCacheKey("/tmp/two.sqlite", "ivv-us", "etf-ivv"),
  );
});

test("uses a normalized reference when the catalog cannot resolve it", () => {
  assert.equal(
    holdingsRefreshCacheKey("/tmp/one.sqlite", "  unknown-etf "),
    "/tmp/one.sqlite::UNKNOWN-ETF",
  );
});
