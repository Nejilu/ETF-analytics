import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeEtfReferences,
  reorderEtfItems,
} from "./metrics-overview-request";

test("canonicalizes ticker and ID aliases before enforcing distinct selections", () => {
  const resolved = new Map([
    ["IVV", { id: "ivv-us" }],
    ["ivv-us", { id: "ivv-us" }],
    ["URTH", { id: "urth-us" }],
  ]);
  let resolutionCalls = 0;

  assert.deepEqual(
    canonicalizeEtfReferences(
      [" IVV ", "ivv-us", "IVV", "URTH"],
      (reference) => {
        resolutionCalls += 1;
        return resolved.get(reference);
      },
    ),
    ["ivv-us", "urth-us"],
  );
  assert.equal(resolutionCalls, 3);
});

test("retains unresolved references so the catalog validation can reject them", () => {
  assert.deepEqual(
    canonicalizeEtfReferences(["not-real", "NOT-REAL"], () => undefined),
    ["not-real", "NOT-REAL"],
  );
});

test("reorders cached ETF payload items without mutating the cached array", () => {
  const items = [
    { etfId: "urth-us", ticker: "URTH" },
    { etfId: "acwi-us", ticker: "ACWI" },
  ];
  const reordered = reorderEtfItems(items, ["acwi-us", "urth-us"]);
  assert.deepEqual(reordered.map((item) => item.etfId), ["acwi-us", "urth-us"]);
  assert.deepEqual(items.map((item) => item.etfId), ["urth-us", "acwi-us"]);
});
