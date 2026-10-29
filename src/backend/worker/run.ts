import type { Database } from "../database/client";
import { makeAdapter } from "../ingestion/registry";
import { IngestionError, safeError } from "../ingestion/errors";
import { claimNext, completeJob, failJob, scheduleDue } from "./queue";

export async function runOne(db: Database, signal: AbortSignal) {
  if (signal.aborted) return null;
  const claim = await claimNext(db);
  if (!claim) return null;
  try {
    if (claim.job.attempts > 5) throw new IngestionError("MAX_ATTEMPTS");
    const batch = await makeAdapter(claim.source.type, claim.source.config).fetchSince(
      claim.source.cursor,
      AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    );
    const counts = await completeJob(db, claim, batch);
    return {
      source: claim.source.slug,
      status: "success" as const,
      ...counts,
      notModified: batch.notModified,
      truncated: batch.truncated,
    };
  } catch (cause) {
    await failJob(db, claim, cause);
    return { source: claim.source.slug, status: "failed" as const, error: safeError(cause).code };
  }
}

export async function runScheduledBatch(db: Database, signal: AbortSignal, budgetMs = 220000) {
  const end = Date.now() + budgetMs;
  await scheduleDue(db);
  const results: NonNullable<Awaited<ReturnType<typeof runOne>>>[] = [];
  // Não reservar trabalho quando já não cabe um fetch de 90s e sua transação.
  while (results.length < 8 && !signal.aborted && end - Date.now() >= 100000) {
    const result = await runOne(db, signal);
    if (!result) break;
    results.push(result);
  }
  return {
    processed: results.length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  };
}
