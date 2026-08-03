import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency } from "./async-utils";

test("maps items in input order while respecting the concurrency bound", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(result, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test("returns an empty result without invoking workers", async () => {
  let invoked = false;
  const result = await mapWithConcurrency([], 4, async () => {
    invoked = true;
    return "unexpected";
  });

  assert.deepEqual(result, []);
  assert.equal(invoked, false);
});
