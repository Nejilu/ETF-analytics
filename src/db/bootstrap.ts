import { migrateDatabase } from "./migrate";
import { seedCatalog } from "./seed";

let ready = false;

export function ensureLocalDatabase(): void {
  if (ready) return;
  migrateDatabase();
  seedCatalog();
  ready = true;
}
