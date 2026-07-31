import "dotenv/config";

import { databasePath } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";

migrateDatabase();
console.log(`Migrations applied to ${databasePath()}`);
