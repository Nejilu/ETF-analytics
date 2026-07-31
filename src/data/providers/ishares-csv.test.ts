import assert from "node:assert/strict";
import test from "node:test";

import { parseIsharesHoldingsCsv } from "./ishares-csv";

test("retains a holding rounded to 0% when market value is positive", () => {
  const parsed = parseIsharesHoldingsCsv(
    [
      'Fund Holdings as of,"29/Jul/2026"',
      "Ticker,Name,Sector,Asset Class,Weight (%),Market Value,Location,ISIN",
      'CORE,Core holding,Technology,Equity,99.99,"999,999",United States,US0000000001',
      'SMALL,Small holding,Technology,Equity,0.00,1,United States,US0000000002',
      'THIRD,Third holding,Technology,Equity,0.01,100,United States,US0000000003',
      'FOURTH,Fourth holding,Technology,Equity,0.01,100,United States,US0000000004',
      'FIFTH,Fifth holding,Technology,Equity,0.01,100,United States,US0000000005',
    ].join("\n"),
  );

  const small = parsed.holdings.find((holding) => holding.ticker === "SMALL");
  assert.equal(small?.weight, 0);
  assert.equal(small?.marketValue, 1);
  assert.equal(parsed.asOf, "2026-07-29");
});

test("parses US-style holdings dates without a timezone shift", () => {
  const parsed = parseIsharesHoldingsCsv(
    [
      'Fund Holdings as of,"Jul 30, 2026"',
      "Ticker,Name,Sector,Asset Class,Weight (%),Market Value,Location,ISIN",
      "ONE,One,Technology,Equity,50,500,United States,US0000000001",
      "TWO,Two,Technology,Equity,20,200,United States,US0000000002",
      "THREE,Three,Technology,Equity,15,150,United States,US0000000003",
      "FOUR,Four,Technology,Equity,10,100,United States,US0000000004",
      "FIVE,Five,Technology,Equity,5,50,United States,US0000000005",
    ].join("\n"),
  );

  assert.equal(parsed.asOf, "2026-07-30");
});
