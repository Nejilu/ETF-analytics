import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { migrateSqlite } from "./migrate";

const canonical = resolve("drizzle");
const journal = JSON.parse(readFileSync(join(canonical, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

test("canonical migration journal has unique indices and increasing timestamps", () => {
  journal.entries.forEach((entry, index) => {
    assert.equal(entry.idx, index);
    if (index) assert(entry.when > journal.entries[index - 1].when);
  });
});

for (const branch of ["local", "web", "fresh"] as const) {
  test(`canonical migrations preserve ${branch} databases and remain idempotent`, () => {
    const directory = mkdtempSync(join(tmpdir(), "weightings-branch-upgrade-"));
    const sqlite = new Database(join(directory, "db.sqlite"));
    sqlite.pragma("foreign_keys = ON");
    try {
      if (branch !== "fresh") {
        const previous = join(directory, "previous");
        mkdirSync(join(previous, "meta"), { recursive: true });
        const entries = journal.entries.filter((entry) => entry.tag !== (
          branch === "local" ? "0014_site_visibility" : "0016_ai_snapshot_reuse"
        )).map((entry, idx) => ({ ...entry, idx }));
        writeFileSync(join(previous, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
        for (const entry of entries) copyFileSync(join(canonical, `${entry.tag}.sql`), join(previous, `${entry.tag}.sql`));
        migrate(drizzle(sqlite), { migrationsFolder: previous });
        sqlite.exec(`
          INSERT INTO benchmarks (id, name, provider) VALUES ('test', 'Test', 'Test');
          INSERT INTO portfolios (id, name) VALUES ('saved', 'Saved portfolio');
          INSERT INTO portfolio_cash_positions (portfolio_id, currency, amount) VALUES ('saved', 'USD', 12345.67);
          INSERT INTO etfs (id, ticker, isin, name, issuer, benchmark_id, wrapper, domicile, exchange, trading_currency, distribution_policy, fund_type, portfolio_id)
          VALUES ('saved-etf', 'SAVED', 'TEST-SAVED', 'Saved ETF', 'Test', 'test', 'UCITS', 'Test', 'Test', 'USD', 'Accumulating', 'portfolio', 'saved');
          INSERT INTO ai_analysis_runs (id, environment_id, thread_id, title, request_json, created_at, updated_at)
          VALUES ('saved-ai', 'test', 'thread', 'Saved research', '{}', '2026-10-01', '2026-10-01');
        `);
        if (branch === "web") sqlite.exec("UPDATE etfs SET visibility = 'public' WHERE id = 'saved-etf'");
        else sqlite.exec("UPDATE ai_analysis_runs SET snapshot_sent_at = '2026-10-02' WHERE id = 'saved-ai'");
      }
      migrateSqlite(sqlite, canonical);
      const count = (sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
      assert.equal(count, journal.entries.length);
      assert((sqlite.pragma("table_info(etfs)") as Array<{ name: string }>).some((column) => column.name === "visibility"));
      if (branch !== "fresh") {
        assert.deepEqual(sqlite.prepare("SELECT name FROM portfolios WHERE id = 'saved'").get(), { name: "Saved portfolio" });
        assert.deepEqual(sqlite.prepare("SELECT amount FROM portfolio_cash_positions WHERE portfolio_id = 'saved'").get(), { amount: 12345.67 });
        assert.deepEqual(sqlite.prepare("SELECT visibility FROM etfs WHERE id = 'saved-etf'").get(), { visibility: branch === "web" ? "public" : "private" });
        assert.deepEqual(sqlite.prepare("SELECT title, snapshot_sent_at FROM ai_analysis_runs WHERE id = 'saved-ai'").get(), {
          title: "Saved research", snapshot_sent_at: branch === "local" ? "2026-10-02" : null,
        });
      }
      migrateSqlite(sqlite, canonical);
      assert.equal((sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n, count);
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
