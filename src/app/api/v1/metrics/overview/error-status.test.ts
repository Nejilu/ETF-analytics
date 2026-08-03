import assert from "node:assert/strict";
import test from "node:test";

import { metricsOverviewErrorStatus } from "./error-status";

test("maps request, provider and internal errors to distinct HTTP statuses", () => {
  assert.equal(metricsOverviewErrorStatus(false, true), 400);
  assert.equal(metricsOverviewErrorStatus(true, false), 503);
  assert.equal(metricsOverviewErrorStatus(false, false), 500);
});

test("gives an invalid request precedence over an unavailable provider", () => {
  assert.equal(metricsOverviewErrorStatus(true, true), 400);
});
