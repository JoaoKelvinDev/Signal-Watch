import { z } from "zod";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { sources, sourceItems, ingestionRuns, jobs } from "../database/schema";
import { processPendingInTransaction } from "../editorial/process";
import { makeAdapter } from "../ingestion/registry";
import { safeError } from "../ingestion/errors";
import type { AdminAction } from "../../shared/contracts/admin";
const evidenceUrl = z
  .url()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });
export const actionSchema: z.ZodType<AdminAction> = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), password: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal("logout") }).strict(),
  z
    .object({
      action: z.literal("create"),
      slug: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().trim().min(1).max(120),
      owner: z
        .string()
        .max(100)
        .regex(/^[\w-]+$/),
      repo: z
        .string()
        .max(100)
        .regex(/^[\w.-]+$/),
      ownershipUrl: evidenceUrl,
      permissions: z.string().trim().min(20).max(1000),
      intervalSeconds: z.number().int().min(300).max(86400),
    })
    .strict(),
  z.object({ action: z.literal("verify"), id: z.uuid(), reviewed: z.literal(true) }).strict(),
  z
    .object({
      action: z.literal("source"),
      id: z.uuid(),
      enabled: z.boolean(),
      intervalSeconds: z.number().int().min(300).max(86400),
    })
    .strict(),
  z.object({ action: z.literal("reprocess"), id: z.uuid(), after: z.uuid().optional() }).strict(),
]);

export async function readAdminDashboard(db: Database) {
  const monitored = await db
    .select({
      id: sources.id,
      name: sources.name,
      ownershipUrl: sources.ownershipUrl,
      documentationUrl: sources.documentationUrl,
      permissions: sources.permissions,
      type: sources.type,
      state: sources.state,
      intervalSeconds: sources.intervalSeconds,
      verifiedAt: sources.verifiedAt,
      lastSuccessAt: sources.lastSuccessAt,
      lastAttemptAt: sources.lastAttemptAt,
      lastError: sources.lastError,
      quota: sources.quota,
    })
    .from(sources)
    .orderBy(asc(sources.name));
  const runs = await db
    .select({
      sourceId: ingestionRuns.sourceId,
      startedAt: ingestionRuns.startedAt,
      finishedAt: ingestionRuns.finishedAt,
      received: ingestionRuns.received,
      inserted: ingestionRuns.inserted,
      duplicates: ingestionRuns.duplicates,
      status: ingestionRuns.status,
      error: ingestionRuns.error,
    })
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(30);
  const queue = await db
    .select({ state: jobs.state, count: count() })
    .from(jobs)
    .groupBy(jobs.state);
  return { sources: monitored, runs, queue };
}
type AdminMutation = Exclude<z.infer<typeof actionSchema>, { action: "login" | "logout" }>;
export async function executeAdminAction(db: Database, action: AdminMutation) {
  if (action.action === "create") {
    const inserted = await db
      .insert(sources)
      .values({
        slug: action.slug,
        name: action.name,
        type: "github_releases",
        domain: "github.com",
        editorialLevel: "official",
        documentationUrl: "https://docs.github.com/en/rest/releases/releases",
        ownershipUrl: action.ownershipUrl,
        permissions: action.permissions,
        config: { owner: action.owner, repo: action.repo, maxPages: 2 },
        intervalSeconds: action.intervalSeconds,
        state: "unverified",
      })
      .onConflictDoNothing({ target: sources.slug })
      .returning({ id: sources.id });
    return inserted.length ? { ok: true } : { conflict: true };
  }
  if (action.action === "verify") {
    const [source] = await db.select().from(sources).where(eq(sources.id, action.id));
    if (!source) return null;
    try {
      await makeAdapter(source.type, source.config).healthCheck(AbortSignal.timeout(90000));
      await db
        .update(sources)
        .set({ verifiedAt: new Date(), state: "active", lastError: null, nextRunAt: new Date() })
        .where(eq(sources.id, source.id));
      return { ok: true };
    } catch (error) {
      const diagnosis = safeError(error);
      await db
        .update(sources)
        .set({
          state: diagnosis.blocked ? "blocked" : "unavailable",
          lastError: diagnosis.code,
          lastAttemptAt: new Date(),
        })
        .where(eq(sources.id, source.id));
      return { blocked: true };
    }
  }
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(sources).where(eq(sources.id, action.id));
    if (!source) return null;
    if (action.action === "source") {
      // Uma fonte bloqueada/não verificada exige diagnóstico e teste de contrato; não há promoção editorial pelo painel.
      if (action.enabled && (!source.verifiedAt || !["active", "paused"].includes(source.state)))
        return { blocked: true };
      const changed = await tx
        .update(sources)
        .set({
          state: action.enabled
            ? "active"
            : sql`case when ${sources.state} = 'active' then 'paused' else ${sources.state} end`,
          intervalSeconds: action.intervalSeconds,
          nextRunAt: new Date(),
        })
        .where(
          and(
            eq(sources.id, source.id),
            action.enabled
              ? and(isNotNull(sources.verifiedAt), inArray(sources.state, ["active", "paused"]))
              : undefined,
          ),
        )
        .returning({ id: sources.id });
      return changed.length ? { ok: true } : { blocked: true };
    }
    const selected = await tx
      .select({ id: sourceItems.id, externalId: sourceItems.externalId })
      .from(sourceItems)
      .where(
        and(
          eq(sourceItems.sourceId, source.id),
          ne(sourceItems.processingState, "removed"),
          action.after ? gt(sourceItems.id, action.after) : undefined,
        ),
      )
      .orderBy(asc(sourceItems.id))
      .limit(101)
      .for("update", { skipLocked: true });
    if (!selected.length) return { processed: 0, nextCursor: null };
    const batch = selected.slice(0, 100);
    await tx
      .update(sourceItems)
      .set({ processingState: "pending" })
      .where(
        inArray(
          sourceItems.id,
          batch.map((item) => item.id),
        ),
      );
    return {
      processed: await processPendingInTransaction(tx, {
        sourceId: source.id,
        externalIds: batch.map((item) => item.externalId),
      }),
      nextCursor: selected.length > 100 ? batch.at(-1)!.id : null,
    };
  });
}
