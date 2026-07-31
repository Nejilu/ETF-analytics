import "dotenv/config";

import { databasePath } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";
import { seedCatalog } from "../src/db/seed";

migrateDatabase();
seedCatalog();
console.log(`Local database ready at ${databasePath()}`);
