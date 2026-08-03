import { migrateDatabase } from "./migrate";
import { seedCatalog } from "./seed";
import { databasePath, isDatabaseOpen } from "./client";

let readyPath: string | undefined;

export function ensureLocalDatabase(): void {
  const path = databasePath();
  if (readyPath === path && isDatabaseOpen()) return;
  migrateDatabase();
  seedCatalog();
  readyPath = path;
}
