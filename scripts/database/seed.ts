import { openDatabase } from "../../src/backend/database/client";
import { sourceCatalog } from "../../src/backend/database/source-catalog";
import { sources } from "../../src/backend/database/schema";
const database = openDatabase();
try {
  await database.db
    .insert(sources)
    .values(sourceCatalog)
    .onConflictDoNothing({ target: sources.slug });
  console.log("Catálogo cadastrado como não verificado. Execute test:online antes de ativar.");
} finally {
  await database.close();
}
