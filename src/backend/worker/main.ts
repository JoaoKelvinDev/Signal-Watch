import { setTimeout as sleep } from "node:timers/promises";
import { openDatabase } from "../database/client";
import { makeAdapter } from "../ingestion/registry";
import { IngestionError, safeError } from "../ingestion/errors";
import { claimNext, completeJob, failJob, scheduleDue } from "./queue";

const database = openDatabase();
const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());
const once = process.argv.includes("--once");
let failures = 0;
try {
  do {
    await scheduleDue(database.db);
    const claim = await claimNext(database.db);
    if (!claim) {
      if (once) break;
      try {
        await sleep(10000, undefined, { signal: shutdown.signal });
      } catch {
        break;
      }
      continue;
    }
    try {
      if (claim.job.attempts > 5) throw new IngestionError("MAX_ATTEMPTS");
      const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(90000)]);
      const batch = await makeAdapter(claim.source.type, claim.source.config).fetchSince(
        claim.source.cursor,
        signal,
      );
      const counts = await completeJob(database.db, claim, batch);
      console.log(
        JSON.stringify({
          source: claim.source.slug,
          status: "success",
          ...counts,
          notModified: batch.notModified,
          truncated: batch.truncated,
        }),
      );
    } catch (error) {
      failures++;
      await failJob(database.db, claim, error);
      console.error(
        JSON.stringify({
          source: claim.source.slug,
          status: "failed",
          error: safeError(error).code,
        }),
      );
    }
  } while (!shutdown.signal.aborted);
} finally {
  await database.close();
}
if (once && failures) process.exitCode = 1;
