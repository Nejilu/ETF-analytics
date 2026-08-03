import assert from "node:assert/strict";
import test from "node:test";

import { fxRateInFlightKey, marketPriceInFlightKey } from "./market-price-cache";

test("separates in-flight prices and FX refreshes by database", () => {
  assert.equal(
    marketPriceInFlightKey("/tmp/one.sqlite", "security", "security-msft"),
    "/tmp/one.sqlite::security:security-msft",
  );
  assert.notEqual(
    marketPriceInFlightKey("/tmp/one.sqlite", "security", "security-msft"),
    marketPriceInFlightKey("/tmp/two.sqlite", "security", "security-msft"),
  );
  assert.equal(fxRateInFlightKey("/tmp/one.sqlite", "gbp"), "/tmp/one.sqlite::fx:GBP");
  assert.notEqual(
    fxRateInFlightKey("/tmp/one.sqlite", "GBP"),
    fxRateInFlightKey("/tmp/two.sqlite", "GBP"),
  );
});
