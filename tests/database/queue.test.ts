import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { count, eq, sql } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
import { ingestionRuns, jobs, sourceItems, sources } from "../../src/backend/database/schema";
import { claimNext, completeJob, failJob, scheduleDue } from "../../src/backend/worker/queue";
import { IngestionError } from "../../src/backend/ingestion/errors";
import { withHash } from "../../src/backend/ingestion/normalize";
import type { Batch } from "../../src/backend/ingestion/contracts";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  process.env.ALLOW_DB_TESTS !== "1" ||
  !/^radar_test(?:_[a-z0-9]+)?$/.test(new URL(url).pathname.slice(1))
) {
  throw new Error(
    "Testes modificam dados: use ALLOW_DB_TESTS=1 e TEST_DATABASE_URL apontando para radar_test ou radar_test_*. Nunca usar banco de produção.",
  );
}
const database = openDatabase(url);
const db = database.db;
const item = withHash({
  externalId: "fixture-1",
  originalUrl: "https://example.org/release?v=1",
  canonicalUrl: "https://example.org/release?v=1",
  discussionUrl: null,
  title: "Versão 1",
  language: null,
  publishedAt: null,
  updatedAt: null,
  version: "1",
  prerelease: false,
});
const batch: Batch = {
  items: [item],
  cursor: { etag: '"committed"' },
  quota: {},
  notModified: false,
  truncated: false,
};

async function addSource(slug = "fixture") {
  const [source] = await db
    .insert(sources)
    .values({
      slug,
      name: "Fixture offline",
      domain: "example.org",
      type: "github_releases",
      editorialLevel: "official",
      documentationUrl: "https://example.org/docs",
      ownershipUrl: "https://example.org/owner",
      permissions: "Fixture de teste",
      config: {},
      state: "active",
      intervalSeconds: 900,
    })
    .returning();
  return source;
}
async function claimOrThrow() {
  const claim = await claimNext(db);
  if (!claim) throw new Error("Job esperado.");
  return claim;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate event_sources, event_versions, events, source_items, ingestion_runs, jobs, sources, summary_cache`,
  );
});
afterAll(async () => {
  await database.close();
});

describe("fila e ingestão em PostgreSQL real", () => {
  it("retry de coleta em andamento não reativa fonte pausada pelo administrador", async () => {
    const source = await addSource();
    await scheduleDue(db);
    const claim = await claimOrThrow();
    await db.update(sources).set({ state: "paused" }).where(eq(sources.id, source.id));
    await failJob(db, claim, new IngestionError("TIMEOUT"));
    expect((await db.select().from(sources).where(eq(sources.id, source.id)))[0].state).toBe(
      "paused",
    );
    expect(await claimNext(db)).toBeNull();
  });
  it("agendadores e workers concorrentes reservam somente um job por fonte", async () => {
    await addSource();
    const scheduled = await Promise.all([scheduleDue(db), scheduleDue(db)]);
    expect(scheduled.reduce((a, b) => a + b, 0)).toBe(1);
    const claims = await Promise.all([claimNext(db), claimNext(db)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await completeJob(
      db,
      claims.find((claim) => claim !== null)!,
      batch,
    );
    expect(await scheduleDue(db)).toBe(0);
    expect(await db.select({ n: count() }).from(sourceItems)).toEqual([{ n: 1 }]);
  });
  it("reprocessamento é idempotente e não muda publicação nula nem descoberta", async () => {
    const source = await addSource();
    await scheduleDue(db);
    expect(await completeJob(db, await claimOrThrow(), batch)).toEqual({
      inserted: 1,
      duplicates: 0,
    });
    const [before] = await db.select().from(sourceItems);
    await db
      .update(sources)
      .set({ nextRunAt: new Date(0) })
      .where(eq(sources.id, source.id));
    await scheduleDue(db);
    expect(await completeJob(db, await claimOrThrow(), batch)).toEqual({
      inserted: 0,
      duplicates: 1,
    });
    const [after] = await db.select().from(sourceItems);
    expect(after.collectedAt).toEqual(before.collectedAt);
    expect(after.publishedAt).toBeNull();
    expect(after.updatedAt).toBeNull();
  });
  it("rollback não avança cursor se falha a gravação de um item", async () => {
    await addSource();
    await scheduleDue(db);
    const claim = await claimOrThrow();
    // NUL é rejeitado por PostgreSQL text, depois de o primeiro item ter sido escrito na transação.
    const broken: Batch = {
      ...batch,
      items: [item, { ...item, externalId: "fixture-2", title: "invalid\u0000text" }],
    };
    await expect(completeJob(db, claim, broken)).rejects.toThrow();
    expect(await db.select({ n: count() }).from(sourceItems)).toEqual([{ n: 0 }]);
    const [source] = await db.select().from(sources);
    expect(source.cursor).toBeNull();
    await completeJob(db, claim, batch);
  });
  it("recupera lease vencido e impede commit de worker antigo", async () => {
    await addSource();
    await scheduleDue(db);
    const old = await claimOrThrow();
    await db
      .update(jobs)
      .set({ leaseUntil: new Date(0) })
      .where(eq(jobs.id, old.job.id));
    const current = await claimOrThrow();
    expect(current.job.attempts).toBe(2);
    expect(current.job.leaseToken).not.toBe(old.job.leaseToken);
    await expect(completeJob(db, old, batch)).rejects.toMatchObject({ code: "LEASE_LOST" });
    await failJob(db, old, new IngestionError("HTTP_401", true));
    await completeJob(db, current, batch);
    const runs = await db.select().from(ingestionRuns);
    expect(runs.map((run) => run.status).sort()).toEqual(["abandoned", "success"]);
  });
  it("401 bloqueia a fonte; outra fonte continua coletando", async () => {
    await addSource("failing");
    await addSource("healthy");
    await scheduleDue(db);
    const first = await claimOrThrow();
    await failJob(db, first, new IngestionError("HTTP_401", true));
    await completeJob(db, await claimOrThrow(), batch);
    const rows = await db.select().from(sources);
    expect(rows.filter((row) => row.state === "blocked")).toHaveLength(1);
    expect(rows.filter((row) => row.lastSuccessAt !== null)).toHaveLength(1);
  });
  it("429 respeita espera, mantém cursor e não revela mensagem externa", async () => {
    await addSource();
    await scheduleDue(db);
    const claim = await claimOrThrow();
    await failJob(db, claim, new IngestionError("RATE_LIMIT", false, 120000));
    const [job] = await db.select().from(jobs);
    expect(job.state).toBe("pending");
    expect(job.runAfter.getTime() - Date.now()).toBeGreaterThan(118000);
    expect(await claimNext(db)).toBeNull();
    const [source] = await db.select().from(sources);
    expect(source.cursor).toBeNull();
    expect(source.lastSuccessAt).toBeNull();
  });
  it("falhas transitórias param depois de cinco tentativas", async () => {
    await addSource();
    await scheduleDue(db);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = await claimOrThrow();
      await failJob(db, claim, new Error("senha privada em URL"));
      await db
        .update(jobs)
        .set({ runAfter: new Date(0) })
        .where(eq(jobs.id, claim.job.id));
    }
    const [job] = await db.select().from(jobs);
    expect(job).toMatchObject({ state: "failed", attempts: 5 });
    const [source] = await db.select().from(sources);
    expect(source.lastError).toBe("INGESTION_FAILED");
    expect(await claimNext(db)).toBeNull();
  });
  it("304 registra último sucesso e preserva itens existentes", async () => {
    const source = await addSource();
    await scheduleDue(db);
    await completeJob(db, await claimOrThrow(), batch);
    await db
      .update(sources)
      .set({ nextRunAt: new Date(0) })
      .where(eq(sources.id, source.id));
    await scheduleDue(db);
    await completeJob(db, await claimOrThrow(), { ...batch, items: [], notModified: true });
    expect(await db.select({ n: count() }).from(sourceItems)).toEqual([{ n: 1 }]);
    const [stored] = await db.select().from(sources);
    expect(stored.cursor).toEqual(batch.cursor);
    expect(stored.lastSuccessAt).not.toBeNull();
  });
  it("itens persistem quando a conexão é reaberta", async () => {
    await addSource();
    await scheduleDue(db);
    await completeJob(db, await claimOrThrow(), batch);
    const reopened = openDatabase(url);
    try {
      expect(await reopened.db.select({ n: count() }).from(sourceItems)).toEqual([{ n: 1 }]);
    } finally {
      await reopened.close();
    }
  });
});
