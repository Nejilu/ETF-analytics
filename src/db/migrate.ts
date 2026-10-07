import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getSqlite } from "./client";

export function migrationsDirectory(): string {
  const configured = process.env.DRIZZLE_MIGRATIONS_PATH?.trim();
  const candidates = [
    configured,
    resolve(process.cwd(), "drizzle"),
    // The generated standalone server is commonly launched from
    // `.next/standalone`, two levels below the project root.
    resolve(process.cwd(), "..", "..", "drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const directory = candidates.find((candidate) =>
    existsSync(resolve(candidate, "meta", "_journal.json")),
  );
  if (!directory) {
    throw new Error(
      "Drizzle migrations are unavailable. Set DRIZZLE_MIGRATIONS_PATH to the migrations directory.",
    );
  }
  return directory;
}

export function migrateSqlite(sqlite: BetterSqlite3.Database, folder: string): void {
  // The former local branch applied 0015/0016 without 0014. Drizzle's
  // timestamp cursor would skip the older visibility migration forever.
  // Apply that one missing historical migration and record its original hash
  // and timestamp; never replay it on a web database or change its SQL.
  const journal = JSON.parse(readFileSync(resolve(folder, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const visibility = journal.entries.find((entry) => entry.tag === "0014_site_visibility");
  const hasJournal = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = '__drizzle_migrations' AND type = 'table'").get();
  if (visibility && hasJournal) {
    const last = sqlite.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1").get() as { created_at: number } | undefined;
    const columns = sqlite.pragma("table_info(etfs)") as Array<{ name: string }>;
    if (last && Number(last.created_at) >= visibility.when && !columns.some((column) => column.name === "visibility")) {
      const historical = readMigrationFiles({ migrationsFolder: folder }).find((entry) => entry.folderMillis === visibility.when)!;
      sqlite.transaction(() => {
        for (const statement of historical.sql) sqlite.exec(statement);
        sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(historical.hash, historical.folderMillis);
      })();
    }
  }
  migrate(drizzle(sqlite), { migrationsFolder: folder });
}

export function migrateDatabase(): void {
  migrateSqlite(getSqlite(), migrationsDirectory());
}
