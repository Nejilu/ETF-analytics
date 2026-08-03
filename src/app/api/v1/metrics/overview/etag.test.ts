import assert from "node:assert/strict";
import test from "node:test";

import { matchesIfNoneMatch, metricsCacheControl, metricsEtag } from "./etag";

test("matches weak, strong and wildcard conditional ETags", () => {
  const etag = metricsEtag('{"data":{"revision":"2026-08-01T12:00:00.000Z"}}');
  assert.equal(matchesIfNoneMatch(etag, etag), true);
  assert.equal(matchesIfNoneMatch(etag.replace(/^W\//, ""), etag), true);
  assert.equal(matchesIfNoneMatch("*", etag), true);
  assert.equal(matchesIfNoneMatch('"metrics-other"', etag), false);
});

test("matches one tag in a comma-separated If-None-Match header", () => {
  const etag = metricsEtag('{"data":{"revision":"2026-08-01T12:00:00.000Z"}}');
  assert.equal(
    matchesIfNoneMatch(`W/"metrics-other", ${etag}, "another"`, etag),
    true,
  );
});

test("includes the ordered ETF selection in the representation ETag", () => {
  const leftToRight = metricsEtag('{"data":{"etfs":["acwi-us","urth-us"]}}');
  const rightToLeft = metricsEtag('{"data":{"etfs":["urth-us","acwi-us"]}}');
  assert.notEqual(leftToRight, rightToLeft);
  assert.equal(
    matchesIfNoneMatch(
      leftToRight,
      metricsEtag('{"data":{"etfs":["acwi-us","urth-us"]}}'),
    ),
    true,
  );
});

test("changes the ETag whenever the serialized representation changes", () => {
  const partialBody = '{"data":{"sourceStatus":"partial","missingMetricCount":1}}';
  const partial = metricsEtag(partialBody);
  assert.equal(
    partial,
    metricsEtag(partialBody),
  );
  assert.notEqual(
    partial,
    metricsEtag('{"data":{"sourceStatus":"partial","missingMetricCount":2}}'),
  );
});

test("uses a reusable cache policy for partial coverage but not stale fallback", () => {
  assert.equal(metricsCacheControl("stale"), "no-store");
  assert.match(metricsCacheControl("partial"), /^private, max-age=60/);
  assert.match(metricsCacheControl("live"), /^public, max-age=300/);
});
