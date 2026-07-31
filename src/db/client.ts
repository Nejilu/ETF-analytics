import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

interface DatabaseState {
  path: string;
  sqlite: BetterSqlite3.Database;
  db: BetterSQLite3Database<typeof schema>;
}

const globalDatabase = globalThis as typeof globalThis & {
  __indexLensDatabase?: DatabaseState;
};

export function databasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  const value = configured || ".data/index-lens.sqlite";
  return isAbsolute(value)
    ? value
    : resolve(/* turbopackIgnore: true */ process.cwd(), value);
}

function createDatabase(): DatabaseState {
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");

  return {
    path,
    sqlite,
    db: drizzle({ client: sqlite, schema }),
  };
}

export function databaseState(): DatabaseState {
  globalDatabase.__indexLensDatabase ??= createDatabase();
  return globalDatabase.__indexLensDatabase;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  return databaseState().db;
}

export function getSqlite(): BetterSqlite3.Database {
  return databaseState().sqlite;
}

export function closeDatabase(): void {
  const state = globalDatabase.__indexLensDatabase;
  if (!state) return;
  state.sqlite.close();
  delete globalDatabase.__indexLensDatabase;
}
