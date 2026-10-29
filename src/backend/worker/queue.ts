import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { ingestionRuns, jobs, sourceItems, sources } from "../database/schema";
import type { Batch } from "../ingestion/contracts";
import { IngestionError, retryDelay, safeError } from "../ingestion/errors";
import { processPendingInTransaction } from "../editorial/process";

export type Claim = {
  job: typeof jobs.$inferSelect;
  source: typeof sources.$inferSelect;
  runId: string;
};

export async function scheduleDue(db: Database): Promise<number> {
  const result = await db.execute(sql`
    insert into jobs (source_id, idempotency_key)
    select s.id, s.id::text || ':' || extract(epoch from s.next_run_at)::text
    from sources s
    where s.state = 'active' and s.next_run_at <= now()
      and not exists (select 1 from jobs j where j.source_id = s.id and j.state in ('pending', 'running'))
    on conflict do nothing returning id
  `);
  return result.rowCount ?? 0;
}

export async function claimNext(db: Database): Promise<Claim | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ job: jobs, source: sources })
      .from(jobs)
      .innerJoin(sources, eq(jobs.sourceId, sources.id))
      .where(
        and(
          eq(sources.state, "active"),
          or(
            and(eq(jobs.state, "pending"), lte(jobs.runAfter, sql`now()`)),
            and(eq(jobs.state, "running"), lte(jobs.leaseUntil, sql`now()`)),
          ),
        ),
      )
      .orderBy(desc(jobs.priority), asc(jobs.runAfter))
      .limit(1)
      .for("update", { of: jobs, skipLocked: true });
    if (!candidate) return null;
    await tx
      .update(ingestionRuns)
      .set({ status: "abandoned", finishedAt: new Date(), error: "LEASE_EXPIRED" })
      .where(and(eq(ingestionRuns.jobId, candidate.job.id), eq(ingestionRuns.status, "running")));
    const [job] = await tx
      .update(jobs)
      .set({
        state: "running",
        attempts: sql`${jobs.attempts} + 1`,
        leaseToken: randomUUID(),
        leaseUntil: sql`now() + interval '180 seconds'`,
      })
      .where(eq(jobs.id, candidate.job.id))
      .returning();
    const [run] = await tx
      .insert(ingestionRuns)
      .values({
        jobId: job.id,
        sourceId: candidate.source.id,
        leaseToken: job.leaseToken!,
        attempt: job.attempts,
        cursor: candidate.source.cursor,
      })
      .returning();
    await tx
      .update(sources)
      .set({ lastAttemptAt: new Date() })
      .where(eq(sources.id, candidate.source.id));
    return { job, source: candidate.source, runId: run.id };
  });
}

function ownedLease(claim: Claim) {
  return and(
    eq(jobs.id, claim.job.id),
    eq(jobs.state, "running"),
    eq(jobs.leaseToken, claim.job.leaseToken!),
    gt(jobs.leaseUntil, sql`now()`),
  );
}

export async function completeJob(
  db: Database,
  claim: Claim,
  batch: Batch,
): Promise<{ inserted: number; duplicates: number }> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(ownedLease(claim))
      .for("update");
    if (!owner) throw new IngestionError("LEASE_LOST");
    let inserted = 0;
    for (const item of batch.items) {
      const result = await tx
        .insert(sourceItems)
        .values({ ...item, sourceId: claim.source.id })
        .onConflictDoNothing({ target: [sourceItems.sourceId, sourceItems.externalId] })
        .returning({ id: sourceItems.id });
      inserted += result.length;
      if (!result.length) {
        // IDs repetidos não viram novidades; conteúdo alterado volta à fila editorial.
        await tx
          .update(sourceItems)
          .set({
            lastSeenAt: new Date(),
            title: item.title,
            canonicalUrl: item.canonicalUrl,
            originalUrl: item.originalUrl,
            discussionUrl: item.discussionUrl,
            version: item.version,
            prerelease: item.prerelease,
            contentHash: item.contentHash,
            publishedAt: sql`coalesce(${sourceItems.publishedAt}, ${item.publishedAt})`,
            processingState: sql`case when ${sourceItems.contentHash} <> ${item.contentHash} then 'pending' else ${sourceItems.processingState} end`,
          })
          .where(
            and(
              eq(sourceItems.sourceId, claim.source.id),
              eq(sourceItems.externalId, item.externalId),
            ),
          );
      }
    }
    await processPendingInTransaction(tx, {
      sourceId: claim.source.id,
      externalIds: batch.items.map((item) => item.externalId),
    });
    const duplicates = batch.items.length - inserted;
    await tx
      .update(sources)
      .set({
        cursor: batch.cursor,
        quota: batch.quota,
        lastSuccessAt: new Date(),
        lastError: batch.truncated ? "WINDOW_TRUNCATED" : null,
        nextRunAt: sql`now() + (${claim.source.intervalSeconds} * (1 + random() * 0.1)) * interval '1 second'`,
      })
      .where(eq(sources.id, claim.source.id));
    await tx
      .update(ingestionRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        received: batch.items.length,
        inserted,
        duplicates,
        cursor: batch.cursor,
      })
      .where(eq(ingestionRuns.id, claim.runId));
    await tx
      .update(jobs)
      .set({ state: "done", leaseUntil: null, leaseToken: null })
      .where(eq(jobs.id, claim.job.id));
    return { inserted, duplicates };
  });
}

export async function failJob(db: Database, claim: Claim, cause: unknown): Promise<void> {
  const error = safeError(cause);
  const terminal = error.blocked || claim.job.attempts >= 5;
  const delayMs = retryDelay(claim.job.attempts, error.retryAfterMs);
  await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(ownedLease(claim))
      .for("update");
    if (!owner) return; // Worker antigo não altera o resultado de um lease recuperado.
    await tx
      .update(jobs)
      .set({
        state: terminal ? "failed" : "pending",
        leaseToken: null,
        leaseUntil: null,
        runAfter: new Date(Date.now() + delayMs),
      })
      .where(eq(jobs.id, claim.job.id));
    await tx
      .update(ingestionRuns)
      .set({ status: terminal ? "failed" : "retry", finishedAt: new Date(), error: error.code })
      .where(eq(ingestionRuns.id, claim.runId));
    await tx
      .update(sources)
      .set({
        state: error.blocked ? "blocked" : sql`${sources.state}`,
        lastError: error.code,
        nextRunAt: new Date(Date.now() + Math.max(delayMs, claim.source.intervalSeconds * 1000)),
      })
      .where(eq(sources.id, claim.source.id));
  });
}
