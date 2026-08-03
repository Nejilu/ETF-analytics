import assert from "node:assert/strict";
import { resolve } from "node:path";

import { migrationsDirectory } from "./migrate";

const previous = process.env.DRIZZLE_MIGRATIONS_PATH;
try {
  process.env.DRIZZLE_MIGRATIONS_PATH = resolve(process.cwd(), "drizzle");
  assert.equal(migrationsDirectory(), resolve(process.cwd(), "drizzle"));
} finally {
  if (previous === undefined) delete process.env.DRIZZLE_MIGRATIONS_PATH;
  else process.env.DRIZZLE_MIGRATIONS_PATH = previous;
}

console.log("Migration path resolution tests passed.");
