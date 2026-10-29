import { ne } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
import { sourceItems } from "../../src/backend/database/schema";
import { processPendingItems } from "../../src/backend/editorial/process";

const database = openDatabase();
try {
  await database.db
    .update(sourceItems)
    .set({ processingState: "pending" })
    .where(ne(sourceItems.processingState, "removed"));
  let total = 0,
    count: number;
  do {
    count = await processPendingItems(database.db);
    total += count;
  } while (count === 100);
  console.log(JSON.stringify({ reprocessed: total }));
} finally {
  await database.close();
}
