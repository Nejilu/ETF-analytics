import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPlausibleIsharesHoldingsCount,
  assertCsvPayload,
  holdingsSourceCandidates,
  isPlausibleIsharesHoldingsCount,
} from "./ishares-source";

test("adds the current Swiss CSV endpoint for legacy UK downloads", () => {
  const legacyUrl =
    "https://www.ishares.com/uk/individual/en/products/999999/fund/1506575576011.ajax?fileType=csv&fileName=TEST_holdings&dataType=fund";

  assert.deepEqual(holdingsSourceCandidates(legacyUrl), [
    legacyUrl,
    "https://www.ishares.com/ch/individual/en/products/999999/fund/1495092304805.ajax?fileType=csv&fileName=TEST_holdings&dataType=fund",
  ]);
});

test("does not alter current or non-iShares source URLs", () => {
  const currentUrl =
    "https://www.ishares.com/ch/individual/en/products/253743/fund/1495092304805.ajax?fileType=csv";
  const externalUrl = "https://example.com/holdings.csv";

  assert.deepEqual(holdingsSourceCandidates(currentUrl), [currentUrl]);
  assert.deepEqual(holdingsSourceCandidates(externalUrl), [externalUrl]);
});

test("rejects HTML responses before they reach the CSV parser", () => {
  assert.throws(
    () => assertCsvPayload("text/html; charset=utf-8", "<!doctype html>"),
    /HTML page instead of a holdings CSV/,
  );
  assert.throws(
    () => assertCsvPayload("", "  <html><body>Not CSV</body></html>"),
    /HTML page instead of a holdings CSV/,
  );
  assert.doesNotThrow(() =>
    assertCsvPayload(
      "text/csv;charset=UTF-8",
      'Fund Holdings as of,"29/Jul/2026"\nTicker,Name,Weight (%)',
    ),
  );
});

test("rejects a truncated ACWI universe without imposing its scale on other ETFs", () => {
  assert.equal(isPlausibleIsharesHoldingsCount("acwi-us", 1_652), false);
  assert.equal(isPlausibleIsharesHoldingsCount("acwi-us", 2_236), true);
  assert.equal(isPlausibleIsharesHoldingsCount("small-etf", 50), true);
  assert.throws(
    () =>
      assertPlausibleIsharesHoldingsCount(
        { id: "acwi-us", ticker: "ACWI" },
        1_652,
      ),
    /appears incomplete/,
  );
});
