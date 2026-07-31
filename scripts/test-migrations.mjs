import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";

const migrationDirectory = resolve(process.cwd(), "drizzle");
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "index-lens-migrations-"),
);
const databaseFile = join(temporaryDirectory, "upgrade.sqlite");
const sqlite = new Database(databaseFile);

function executeMigration(filename) {
  const sql = readFileSync(
    join(migrationDirectory, filename),
    "utf8",
  ).replaceAll("--> statement-breakpoint", "");
  sqlite.exec(sql);
}

try {
  executeMigration("0000_woozy_frightful_four.sql");
  sqlite
    .prepare(
      "INSERT INTO benchmarks (id, name, provider) VALUES (?, ?, ?)",
    )
    .run("legacy", "Legacy benchmark", "Test");
  sqlite
    .prepare(
      `INSERT INTO etfs (
        id, ticker, isin, name, issuer, benchmark_id, wrapper, domicile,
        exchange, trading_currency, distribution_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-etf",
      "OLD",
      "TEST-OLD",
      "Legacy ETF",
      "Test",
      "legacy",
      "UCITS",
      "Test",
      "Test",
      "USD",
      "Accumulating",
    );

  executeMigration("0001_local_persistence.sql");
  executeMigration("0002_cold_firelord.sql");
  executeMigration("0003_safe_sentry.sql");

  const upgradedEtf = sqlite
    .prepare(
      `SELECT product_url AS productUrl, holdings_url AS holdingsUrl,
        fund_type AS fundType
       FROM etfs WHERE id = ?`,
    )
    .get("legacy-etf");
  assert.deepEqual(upgradedEtf, {
    productUrl: "",
    holdingsUrl: "",
    fundType: "physical",
  });

  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('portfolios', 'portfolio_items')
       ORDER BY name`,
    )
    .all();
  assert.deepEqual(
    tables.map((table) => table.name),
    ["portfolio_items", "portfolios"],
  );

  console.log("Migration smoke test passed.");
} finally {
  sqlite.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
