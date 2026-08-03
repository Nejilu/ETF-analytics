import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPlausibleIsharesHoldingsCount,
  assertCsvPayload,
  fetchIsharesHoldingsFile,
  holdingsSourceCandidates,
  isPlausibleIsharesHoldingsCount,
} from "./ishares-source";

test("adds the current Swiss CSV endpoint for legacy UK downloads", () => {
  const legacyUrl =
    "https://www.ishares.com/uk/individual/en/products/999999/fund/1506575576011.ajax?fileType=csv&fileName=TEST_holdings&dataType=fund";

  assert.deepEqual(holdingsSourceCandidates(legacyUrl), [
    legacyUrl,
    "https://www.ishares.com/ch/individual/en/products/999999/fund/1495092304805.ajax?fileType=csv&fileName=TEST_holdings&dataType=fund",
    "https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v2/get-product-data?portfolioId=999999&component=holdings&appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=uk-ishares&locale=en_GB&userType=individual",
  ]);
});

test("does not alter current or non-iShares source URLs", () => {
  const currentUrl =
    "https://www.ishares.com/ch/individual/en/products/253743/fund/1495092304805.ajax?fileType=csv";
  const externalUrl = "https://example.com/holdings.csv";

  assert.deepEqual(holdingsSourceCandidates(currentUrl), [currentUrl]);
  assert.deepEqual(holdingsSourceCandidates(externalUrl), [externalUrl]);
});

test("adds the BlackRock product-data fallback for a US latest-holdings URL", () => {
  const primaryUrl =
    "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv";

  assert.deepEqual(holdingsSourceCandidates(primaryUrl), [
    primaryUrl,
    "https://www.blackrock.com/varnish-api/blk-one01-product-data/product-data/api/v2/get-product-data?portfolioId=239726&component=holdings&appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=us-ishares&locale=en_US&userType=individual",
  ]);
});

test("derives the UK BlackRock fallback from the product page when the CSV is Swiss", () => {
  const swissCsvUrl =
    "https://www.ishares.com/ch/individual/en/products/339541/ishares-s-p-500-top-20-ucits-etf/1495092304805.ajax?fileType=csv&fileName=SP20_holdings&dataType=fund";
  const ukProductUrl =
    "https://www.ishares.com/uk/individual/en/products/339541/ishares-s-p-500-top-20-ucits-etf";

  assert.deepEqual(holdingsSourceCandidates(swissCsvUrl, ukProductUrl), [
    swissCsvUrl,
    "https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v2/get-product-data?portfolioId=339541&component=holdings&appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=uk-ishares&locale=en_GB&userType=individual",
  ]);
});

test("retries an empty US CSV through the dated BlackRock response", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const primaryUrl =
    "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv";
  const etf = {
    id: "ivv-us",
    ticker: "IVV",
    productUrl: "https://www.ishares.com/us/products/239726/IVV",
    holdingsUrl: primaryUrl,
  } as Parameters<typeof fetchIsharesHoldingsFile>[0];
  const metadata = JSON.stringify({
    componentsByNameMap: {
      holdings: {
        containersByNameMap: {
          all: { dataPointsByNameMap: { dateList: { value: [20260731] } } },
        },
      },
    },
  });
  const dated = JSON.stringify({
    componentsByNameMap: {
      holdings: {
        containersByNameMap: {
          all: {
            dataPointsByNameMap: {
              ticker: { value: ["A", "B", "C", "D", "E"] },
              holdingPercent: { value: [20, 20, 20, 20, 20] },
            },
          },
        },
      },
    },
  });

  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === primaryUrl) {
      return new Response(
        'Fund Holdings as of,"-"\nTicker,Name,Weight (%)\n',
        { headers: { "content-type": "text/plain" } },
      );
    }
    if (!url.includes("asOfDate=")) {
      return new Response(metadata, {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(dated, {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await fetchIsharesHoldingsFile(etf, 3_600, true);
    assert.equal(result.sourceUrl.endsWith("asOfDate=20260731"), true);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  assert.doesNotThrow(() =>
    assertCsvPayload(
      "application/json",
      '{"componentsByNameMap":{"holdings":{}}}',
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
