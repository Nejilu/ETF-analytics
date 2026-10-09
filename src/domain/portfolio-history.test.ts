import assert from "node:assert/strict";
import test from "node:test";
import { portfolioHistoryClock, portfolioSnapshotDue } from "./portfolio-history";

test("daily schedule follows New York daylight saving and calendar dates", () => {
  assert.deepEqual(portfolioHistoryClock(new Date("2026-07-10T20:10:00Z")), { date: "2026-07-10", minutes: 970 });
  assert.deepEqual(portfolioHistoryClock(new Date("2026-12-10T21:10:00Z")), { date: "2026-12-10", minutes: 970 });
  assert.equal(portfolioHistoryClock(new Date("2026-07-11T02:00:00Z")).date, "2026-07-10");
});

test("initial capture, missed-close recovery, daily deduplication and 24h fallback", () => {
  const latest = { date: "2026-07-09", capturedAt: "2026-07-09T20:10:00Z" };
  assert.equal(portfolioSnapshotDue(new Date("2026-07-10T10:00:00Z")), "initial");
  assert.equal(portfolioSnapshotDue(new Date("2026-07-10T20:09:59Z"), latest), null);
  assert.equal(portfolioSnapshotDue(new Date("2026-07-10T20:10:00Z"), latest), "scheduled");
  assert.equal(portfolioSnapshotDue(new Date("2026-07-10T23:00:00Z"), latest), "scheduled");
  assert.equal(portfolioSnapshotDue(new Date("2026-07-11T10:00:00Z"), latest), "catchup");
  assert.equal(portfolioSnapshotDue(new Date("2026-07-10T23:00:00Z"), { date: "2026-07-10", capturedAt: "2026-07-10T10:00:00Z" }), null);
  assert.equal(portfolioSnapshotDue(new Date("2026-07-10T23:00:00Z"), { date: "2026-07-12", capturedAt: "2026-07-12T10:00:00Z" }), null);
});

test("scheduled close survives spring DST's 23-hour day; fallback survives fall DST's 25-hour day", () => {
  assert.equal(portfolioSnapshotDue(new Date("2026-03-08T20:10:00Z"), { date: "2026-03-07", capturedAt: "2026-03-07T21:10:00Z" }), "scheduled");
  assert.equal(portfolioSnapshotDue(new Date("2026-11-01T20:11:00Z"), { date: "2026-10-31", capturedAt: "2026-10-31T20:10:00Z" }), "catchup");
});
