import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
import {
  events,
  sources,
  sourceItems,
  eventSources,
  eventVersions,
} from "../../src/backend/database/schema";
import { parseFeedParameters } from "../../src/backend/feed/parameters";
import { readFeed } from "../../src/backend/feed/repository";
import { readEvent } from "../../src/backend/feed/event";
import { executeAdminAction, readAdminDashboard } from "../../src/backend/admin/service";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  process.env.ALLOW_DB_TESTS !== "1" ||
  !/^radar_test(?:_[a-z0-9]+)?$/.test(new URL(url).pathname.slice(1))
)
  throw new Error("Banco de teste descartável obrigatório.");
const database = openDatabase(url),
  db = database.db;
beforeAll(() => migrate(db, { migrationsFolder: "./drizzle" }));
beforeEach(async () => {
  await db.execute(
    sql`truncate event_sources, event_versions, summary_cache, events, ingestion_runs, jobs, source_items, sources cascade`,
  );
});
afterAll(() => database.close());
async function fixture() {
  const [source] = await db
    .insert(sources)
    .values({
      slug: "official",
      name: "Fonte oficial",
      domain: "github.com",
      type: "github_releases",
      editorialLevel: "official",
      documentationUrl: "https://docs.github.com",
      ownershipUrl: "https://example.org",
      permissions: "Fixture",
      config: {},
      verifiedAt: new Date(),
      state: "active",
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      title: "Modelo novo",
      dedupKey: randomUUID(),
      category: "ai",
      topics: ["models"],
      companies: ["OpenAI"],
      type: "release",
      editorialStatus: "official_announcement",
      rationale: "Atribuído ao emissor",
      publishedAt: new Date("2026-10-29T12:00:00Z"),
    })
    .returning();
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId: source.id,
      externalId: "1",
      originalUrl: "https://example.org/model",
      canonicalUrl: "https://example.org/model",
      title: "Model released",
      language: "en",
      contentHash: "fixture",
      processingState: "processed",
    })
    .returning();
  await db.insert(eventSources).values({
    eventId: event.id,
    sourceItemId: item.id,
    role: "primary",
    evidenceUrl: item.originalUrl,
    claim: item.title,
  });
  return { source, event, item };
}
const feed = (query: string) => readFeed(db, parseFeedParameters(new URLSearchParams(query)));
describe("MVP persistido", () => {
  it("pesquisa e empresa tratam entrada SQL como texto e preservam o acervo", async () => {
    await fixture();
    for (const query of [
      new URLSearchParams({ q: "'); DROP TABLE events; --" }),
      new URLSearchParams({ company: "OpenAI' OR true --" }),
    ])
      expect((await feed(query.toString())).items).toEqual([]);
    expect((await feed("")).items).toHaveLength(1);
  });
  it("alteração concorrente não reativa uma fonte bloqueada após a leitura inicial", async () => {
    const { source } = await fixture();
    let unlock!: () => void, locked!: () => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await tx.update(sources).set({ state: "blocked" }).where(eq(sources.id, source.id));
      locked();
      await release;
    });
    await ready;
    const mutation = executeAdminAction(db, {
      action: "source",
      id: source.id,
      enabled: true,
      intervalSeconds: 900,
    });
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await db.execute<{ waiting: boolean }>(
          sql`select exists (select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'update "sources"%') as waiting`,
        );
        if (result.rows[0].waiting) {
          waiting = true;
          break;
        }
        await sleep(10);
      }
    } finally {
      unlock();
      await blocker;
    }
    const result = await mutation;
    expect(waiting).toBe(true);
    expect(result).toEqual({ blocked: true });
    expect((await readAdminDashboard(db)).sources[0].state).toBe("blocked");
  });
  it("reprocessamento administrativo repetido preserva identidade e histórico", async () => {
    const { source } = await fixture();
    const first = await executeAdminAction(db, { action: "reprocess", id: source.id });
    expect(first).toMatchObject({ processed: 1, nextCursor: null });
    const before = await db.execute(
      sql`select (select count(*) from events) as events, (select count(*) from event_versions) as versions`,
    );
    expect(await executeAdminAction(db, { action: "reprocess", id: source.id })).toMatchObject({
      processed: 1,
      nextCursor: null,
    });
    const after = await db.execute(
      sql`select (select count(*) from events) as events, (select count(*) from event_versions) as versions`,
    );
    expect(after.rows).toEqual(before.rows);
  });
  it("cadastro administrativo começa não verificado e não substitui fonte existente", async () => {
    const action = {
      action: "create" as const,
      slug: "new-project",
      name: "Projeto oficial",
      owner: "example",
      repo: "project",
      ownershipUrl: "https://example.org/project",
      permissions: "Somente metadados públicos revisados pelo administrador.",
      intervalSeconds: 900,
    };
    expect(await executeAdminAction(db, action)).toEqual({ ok: true });
    expect(await executeAdminAction(db, action)).toEqual({ conflict: true });
    const dashboard = await readAdminDashboard(db);
    expect(dashboard.sources[0].state).toBe("unverified");
    expect(dashboard.sources[0].verifiedAt).toBeNull();
  });
  it("admin pausa a coleta e não ativa fonte sem verificação", async () => {
    const { source } = await fixture();
    expect(
      await executeAdminAction(db, {
        action: "source",
        id: source.id,
        enabled: false,
        intervalSeconds: 1200,
      }),
    ).toEqual({ ok: true });
    const paused = await readAdminDashboard(db);
    expect(paused.sources[0].state).toBe("paused");
    expect(
      await executeAdminAction(db, {
        action: "source",
        id: source.id,
        enabled: true,
        intervalSeconds: 1200,
      }),
    ).toEqual({ ok: true });
    await db.update(sources).set({ state: "blocked" }).where(eq(sources.id, source.id));
    await executeAdminAction(db, {
      action: "source",
      id: source.id,
      enabled: false,
      intervalSeconds: 1200,
    });
    expect((await readAdminDashboard(db)).sources[0].state).toBe("blocked");
    expect(
      await executeAdminAction(db, {
        action: "source",
        id: source.id,
        enabled: true,
        intervalSeconds: 1200,
      }),
    ).toEqual({ blocked: true });
  });
  it("combina filtros de tema, empresa, idioma, origem, tipo, status e período", async () => {
    const { event } = await fixture();
    const page = await feed(
      "topic=models&company=OpenAI&language=en&origin=official&type=release&status=official_announcement&from=2026-10-29T00:00:00Z&to=2026-10-30T00:00:00Z",
    );
    expect(page.items.map((item) => item.id)).toEqual([event.id]);
    for (const filter of [
      "topic=security",
      "company=Anthropic",
      "language=pt",
      "origin=community",
      "type=incident",
      "status=corrected",
      "from=2026-10-30T00:00:00Z",
    ])
      expect((await feed(filter)).items).toEqual([]);
  });
  it("datas e idiomas desconhecidos permanecem desconhecidos", async () => {
    const { item, event } = await fixture();
    await db.update(sourceItems).set({ language: null }).where(eq(sourceItems.id, item.id));
    await db.update(events).set({ publishedAt: null }).where(eq(events.id, event.id));
    expect((await feed("language=unknown")).items).toHaveLength(1);
    expect((await feed("from=2020-01-01T00:00:00Z")).items).toHaveLength(0);
  });
  it("página do evento mantém evidência e histórico sem expor conteúdo bruto", async () => {
    const { event } = await fixture();
    await db.insert(eventVersions).values({
      eventId: event.id,
      previousContent: { title: "Título anterior", secret: "não expor" },
      contentHash: "fixture",
      rationale: "Correção da fonte",
    });
    const detail = await readEvent(db, event.id);
    expect(detail?.item.sources[0].originalUrl).toBe("https://example.org/model");
    expect(detail?.history[0].previousTitle).toBe("Título anterior");
    expect(JSON.stringify(detail)).not.toContain("não expor");
    expect(await readEvent(db, randomUUID())).toBeNull();
  });
  it("paginação por relevância não repete eventos empatados", async () => {
    const { source, event, item } = await fixture();
    const [second] = await db
      .insert(events)
      .values({
        title: "Tecnologia",
        dedupKey: randomUUID(),
        category: "technology",
        type: "release",
        editorialStatus: "official_announcement",
        rationale: "Fixture",
      })
      .returning();
    await db.insert(eventSources).values({
      eventId: second.id,
      sourceItemId: item.id,
      role: "primary",
      evidenceUrl: item.originalUrl,
      claim: source.name,
    });
    const page = await feed("category=all&sort=relevance&pageSize=1");
    expect(page.items[0].id).toBe(event.id);
    const next = await feed(`category=all&sort=relevance&pageSize=1&cursor=${page.nextCursor}`);
    expect(next.items.map((row) => row.id)).toEqual([second.id]);
  });
  it("RLS nega leitura por papel sem bypass, mesmo com GRANT SELECT", async () => {
    await fixture();
    const rollback = new Error("ROLLBACK_PROBE");
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`create role radar_rls_probe nologin`);
        await tx.execute(sql`grant usage on schema public to radar_rls_probe`);
        await tx.execute(sql`grant select on all tables in schema public to radar_rls_probe`);
        await tx.execute(sql`set local role radar_rls_probe`);
        const result = await tx.execute<{ count: string }>(sql`select count(*) from public.events`);
        expect(Number(result.rows[0].count)).toBe(0);
        const enabled = await tx.execute<{ count: string }>(
          sql`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity`,
        );
        expect(Number(enabled.rows[0].count)).toBe(8);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
