import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openDatabase } from "../../src/backend/database/client";
const database = openDatabase();
try {
  await migrate(database.db, { migrationsFolder: "./drizzle" });
  console.log("Migrações aplicadas.");
} finally {
  await database.close();
}
