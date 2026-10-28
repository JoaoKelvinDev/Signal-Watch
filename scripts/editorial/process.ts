import { openDatabase } from "../../src/backend/database/client";
import { processPendingItems } from "../../src/backend/editorial/process";

const database = openDatabase();
let processed = 0;
try {
  let batch: number;
  do {
    batch = await processPendingItems(database.db);
    processed += batch;
  } while (batch > 0);
  console.log(JSON.stringify({ status: "success", processed }));
} finally {
  await database.close();
}
