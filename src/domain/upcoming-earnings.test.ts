import assert from "node:assert/strict";
import test from "node:test";
import {
  parseUpcomingEarningsDate, upcomingEarningsAreFresh, upcomingEarningsView,
  type UpcomingEarningsObservation,
} from "./upcoming-earnings";

const now = Date.parse("2026-10-07T12:00:00.000Z");
const observation: UpcomingEarningsObservation = {
  providerSymbol: "NASDAQ:MSFT", reportDate: "2026-10-27", exchangeTimezone: "America/New_York",
  capturedAt: "2026-10-07T10:00:00.000Z",
};

test("interprets Unix seconds in the listing timezone rather than the user's timezone", () => {
  const timestamp = Date.parse("2026-10-28T01:00:00.000Z") / 1_000;
  assert.equal(parseUpcomingEarningsDate(timestamp, "America/New_York").reportDate, "2026-10-27");
  assert.equal(parseUpcomingEarningsDate(timestamp, "Asia/Tokyo").reportDate, "2026-10-28");
  assert.deepEqual(parseUpcomingEarningsDate(null, "America/New_York"), { reportDate: null, exchangeTimezone: "America/New_York" });
  assert.equal(parseUpcomingEarningsDate(timestamp * 1_000, "America/New_York").reportDate, null);
  assert.equal(parseUpcomingEarningsDate(NaN, "America/New_York").reportDate, null);
  assert.deepEqual(parseUpcomingEarningsDate(timestamp, "invalid"), { reportDate: "2026-10-28", exchangeTimezone: null });
});

test("uses the calendar cache only for the current listing, caching a missing date too", () => {
  assert.equal(upcomingEarningsAreFresh(observation, "NASDAQ:MSFT", 86_400, now), true);
  assert.equal(upcomingEarningsAreFresh(observation, "NYSE:OTHER", 86_400, now), false);
  assert.equal(upcomingEarningsAreFresh(observation, "NASDAQ:MSFT", 0, now), false);
  assert.equal(upcomingEarningsAreFresh({ ...observation, reportDate: null }, "NASDAQ:MSFT", 86_400, now), true);
  assert.equal(upcomingEarningsView(observation, "NYSE:OTHER", 86_400, now, false, now).sourceStatus, "unavailable");
});

test("does not display past reports as upcoming and retries on a new exchange day", () => {
  const old = { ...observation, reportDate: "2026-10-06", capturedAt: "2026-10-06T22:00:00.000Z" };
  assert.equal(upcomingEarningsAreFresh(old, "NASDAQ:MSFT", 86_400, now), false);
  const view = upcomingEarningsView(old, "NASDAQ:MSFT", 86_400, now, false, now);
  assert.equal(view.reportDate, null);
  assert.equal(view.sourceStatus, "stale");
  assert.equal(upcomingEarningsAreFresh({ ...old, capturedAt: observation.capturedAt }, "NASDAQ:MSFT", 86_400, now), true);
});

test("labels an unavailable refresh as stale without discarding a compatible future date", () => {
  const view = upcomingEarningsView(observation, "NASDAQ:MSFT", 86_400, now, true, now);
  assert.equal(view.reportDate, "2026-10-27");
  assert.equal(view.sourceStatus, "stale");
  assert.equal(upcomingEarningsView(observation, "NASDAQ:MSFT", 86_400, now - 3 * 3_600_000, false, now).sourceStatus, "live");
});
