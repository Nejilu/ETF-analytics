import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { ensureLocalDatabase } from "@/db/bootstrap";
import { closeDatabase, getSqlite } from "@/db/client";
import { loadPortfolioHistory, setPortfolioHistoryEnabled } from "@/db/repositories/portfolio-history-repository";
import { GET, PATCH } from "@/app/api/v1/portfolio/history/route";
import { capturePortfolioIfDue } from "./portfolio-history-service";
import type { FxRate } from "@/domain/portfolio";

test("history persists both currencies, catches up, retries failures and honors edits and pause", async () => {
  const previousPath = process.env.DATABASE_PATH;
  const previousMode = process.env.SITE_ACCESS_MODE;
  const directory = mkdtempSync(join(tmpdir(), "portfolio-history-test-"));
  const now = new Date("2026-10-09T20:10:00Z");
  let calls = 0;
  let fail = false;
  let stale = false;
  let duringCapture: (() => void) | undefined;
  const market = {
    async getFxRate(): Promise<FxRate> {
      calls++;
      if (fail) throw new Error("FX offline");
      duringCapture?.();
      return { currency: "EUR", providerSymbol: "EURUSD=X", rateToUsd: 1.25, asOf: now.toISOString(), fetchedAt: now.toISOString(), sourceStatus: stale ? "stale" : "live" };
    },
    async valueCashPositions() { return [{ currency: "USD" as const, amount: 1000, valueUsd: 1000, fxStatus: "cached" as const, fxAsOf: now.toISOString() }]; },
    async valuePortfolioItems(_items: unknown, cash = 0, options: { forceRefresh?: boolean; requireFresh?: boolean } = {}) {
      assert.deepEqual(options, { forceRefresh: true, requireFresh: true });
      return { items: [], totalMarketValueUsd: cash };
    },
  };
  try {
    process.env.DATABASE_PATH = join(directory, "history.sqlite");
    process.env.SITE_ACCESS_MODE = "local";
    ensureLocalDatabase();
    const sqlite = getSqlite();
    for (const id of ["saved", "second", "empty"]) sqlite.prepare("INSERT INTO portfolios (id, name) VALUES (?, ?)").run(id, id);
    for (const id of ["saved", "second"]) sqlite.prepare("INSERT INTO portfolio_cash_positions (portfolio_id, currency, amount) VALUES (?, 'USD', 1000)").run(id);
    assert.equal(loadPortfolioHistory("saved").enabled, true);
    const request = capturePortfolioIfDue("saved", now, market);
    assert.equal(capturePortfolioIfDue("saved", now, market), request);
    await request;
    let history = loadPortfolioHistory("saved");
    assert.equal(history.snapshots.length, 1);
    assert.equal(history.snapshots[0].valueUsd, 1000);
    assert.equal(history.snapshots[0].valueEur, 800);
    assert.equal(history.snapshots[0].eurToUsd, 1.25);
    await capturePortfolioIfDue("saved", new Date("2026-10-09T23:00:00Z"), market);
    assert.equal(calls, 1);
    closeDatabase();
    ensureLocalDatabase();
    assert.equal(loadPortfolioHistory("saved").snapshots.length, 1);
    await capturePortfolioIfDue("saved", new Date("2026-10-12T10:00:00Z"), market);
    history = loadPortfolioHistory("saved");
    assert.deepEqual(history.snapshots.map((point) => point.date), ["2026-10-09", "2026-10-12"]);
    assert.equal(history.snapshots[1].reason, "catchup");
    setPortfolioHistoryEnabled("saved", false);
    await capturePortfolioIfDue("saved", new Date("2026-10-13T21:00:00Z"), market);
    assert.equal(calls, 2);
    assert.equal(loadPortfolioHistory("saved").snapshots.length, 2);
    setPortfolioHistoryEnabled("saved", true);
    fail = true;
    await capturePortfolioIfDue("saved", new Date("2026-10-13T21:00:00Z"), market);
    assert.match(loadPortfolioHistory("saved").lastError!, /FX offline/);
    fail = false;
    await capturePortfolioIfDue("saved", new Date("2026-10-13T21:01:00Z"), market);
    assert.equal(calls, 3);
    stale = true;
    await capturePortfolioIfDue("saved", new Date("2026-10-13T21:05:00Z"), market);
    assert.equal(loadPortfolioHistory("saved").snapshots.length, 2);
    stale = false;
    await capturePortfolioIfDue("saved", new Date("2026-10-13T21:10:00Z"), market);
    assert.equal(loadPortfolioHistory("saved").snapshots.length, 3);
    assert.equal(loadPortfolioHistory("saved").lastError, null);
    duringCapture = () => setPortfolioHistoryEnabled("second", false);
    await capturePortfolioIfDue("second", now, market);
    assert.equal(loadPortfolioHistory("second").snapshots.length, 0);
    setPortfolioHistoryEnabled("second", true);
    duringCapture = () => getSqlite().prepare("UPDATE portfolio_cash_positions SET amount = 2000 WHERE portfolio_id = 'second'").run();
    await capturePortfolioIfDue("second", new Date("2026-10-09T20:20:00Z"), market);
    assert.equal(loadPortfolioHistory("second").snapshots.length, 0);
    assert.match(loadPortfolioHistory("second").lastError!, /changed during capture/);
    duringCapture = undefined;
    const count = calls;
    await capturePortfolioIfDue("empty", now, market);
    assert.equal(calls, count);
    setPortfolioHistoryEnabled("saved", false);
    const req = (url: string, init?: RequestInit) => new Request(`http://localhost/api/v1/portfolio/history${url}`, { ...init, headers: { host: "localhost", origin: "http://localhost", "Content-Type": "application/json" } });
    const response = await GET(req("?portfolioId=saved"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.snapshots.length, 3);
    assert.equal((await GET(req("?portfolioId=unknown"))).status, 400);
    assert.equal((await GET(req(""))).status, 400);
    assert.equal((await PATCH(req("?portfolioId=saved", { method: "PATCH", body: '{"enabled":"false"}' }))).status, 400);
    assert.equal((await PATCH(req("?portfolioId=saved", { method: "PATCH", body: '{"enabled":false}' }))).status, 200);
    getSqlite().prepare("DELETE FROM portfolios WHERE id = 'saved'").run();
    assert.equal(loadPortfolioHistory("saved").snapshots.length, 0);
  } finally {
    closeDatabase();
    if (previousPath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousPath;
    if (previousMode === undefined) delete process.env.SITE_ACCESS_MODE; else process.env.SITE_ACCESS_MODE = previousMode;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
