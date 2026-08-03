import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb } from "./client";

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

export function migrateDatabase(): void {
  migrate(getDb(), {
    migrationsFolder: migrationsDirectory(),
  });
}
