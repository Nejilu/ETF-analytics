import "dotenv/config";

import { statSync } from "node:fs";

import { databasePath, getSqlite } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";

migrateDatabase();

const sqlite = getSqlite();
const tables = [
  "benchmarks",
  "etfs",
  "securities",
  "holding_snapshots",
  "holdings",
  "portfolios",
  "portfolio_items",
  "metric_definitions",
  "metric_observations",
] as const;

console.log(`Database: ${databasePath()}`);
console.log(`Size: ${statSync(databasePath()).size.toLocaleString()} bytes`);

for (const table of tables) {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  console.log(`${table}: ${row.count.toLocaleString()}`);
}
