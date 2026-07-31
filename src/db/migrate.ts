import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb } from "./client";

export function migrateDatabase(): void {
  migrate(getDb(), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  });
}
