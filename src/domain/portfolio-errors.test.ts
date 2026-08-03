import assert from "node:assert/strict";
import test from "node:test";

import {
  MarketPriceRequestError,
  MarketPriceUnavailableError,
} from "./portfolio";

test("market-price errors preserve their API classification", () => {
  const requestError = new MarketPriceRequestError("Unknown security.");
  const unavailableError = new MarketPriceUnavailableError(
    new Error("Yahoo timed out."),
  );

  assert.equal(requestError.name, "MarketPriceRequestError");
  assert.equal(requestError.message, "Unknown security.");
  assert.equal(unavailableError.name, "MarketPriceUnavailableError");
  assert.equal(unavailableError.message, "Yahoo timed out.");
});

test("market-price unavailable errors have a safe fallback message", () => {
  assert.equal(
    new MarketPriceUnavailableError().message,
    "The market price is unavailable.",
  );
});
