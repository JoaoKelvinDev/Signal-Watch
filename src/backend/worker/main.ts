import { setTimeout as sleep } from "node:timers/promises";
import { openDatabase } from "../database/client";
import { scheduleDue } from "./queue";
import { runOne } from "./run";

const database = openDatabase();
const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());
const once = process.argv.includes("--once");
let failures = 0;
try {
  do {
    await scheduleDue(database.db);
    const result = await runOne(database.db, shutdown.signal);
    if (!result) {
      if (once) break;
      try {
        await sleep(10000, undefined, { signal: shutdown.signal });
      } catch {
        break;
      }
      continue;
    }
    if (result.status === "failed") {
      failures++;
      console.error(JSON.stringify(result));
    } else console.log(JSON.stringify(result));
  } while (!shutdown.signal.aborted);
} finally {
  await database.close();
}
if (once && failures) process.exitCode = 1;
