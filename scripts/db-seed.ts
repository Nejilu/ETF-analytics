import "dotenv/config";

import { databasePath } from "../src/db/client";
import { seedCatalog } from "../src/db/seed";

seedCatalog();
console.log(`ETF catalog seeded in ${databasePath()}`);
