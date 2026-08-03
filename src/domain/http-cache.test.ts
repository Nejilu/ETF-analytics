import assert from "node:assert/strict";
import test from "node:test";

import { cacheControlForSource } from "./http-cache";

test("does not cache stale source responses", () => {
  assert.equal(cacheControlForSource("stale", "private, max-age=60"), "no-store");
  assert.equal(cacheControlForSource("live", "private, max-age=60"), "private, max-age=60");
  assert.equal(cacheControlForSource("cached", "public, max-age=300"), "public, max-age=300");
});
