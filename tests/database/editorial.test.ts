import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { count, eq, sql } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
import {
  events,
  eventSources,
  eventVersions,
  sourceItems,
  sources,
} from "../../src/backend/database/schema";
import { processPendingItems } from "../../src/backend/editorial/process";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  process.env.ALLOW_DB_TESTS !== "1" ||
  !/^radar_test(?:_[a-z0-9]+)?$/.test(new URL(url).pathname.slice(1))
)
  throw new Error(
    "Use somente ALLOW_DB_TESTS=1 com TEST_DATABASE_URL em radar_test ou radar_test_* descartável.",
  );
const database = openDatabase(url);
const db = database.db;
const releaseUrl = "https://github.com/huggingface/transformers/releases/tag/v1.2.3";

async function addSource(community = false) {
  const [source] = await db
    .insert(sources)
    .values({
      slug: community ? "hn" : "transformers",
      name: community ? "Hacker News" : "Hugging Face",
      domain: community ? "news.ycombinator.com" : "github.com",
      type: community ? "hacker_news" : "github_releases",
      editorialLevel: community ? "community" : "official",
      verifiedAt: new Date(),
      documentationUrl: "https://example.org/docs",
      ownershipUrl: "https://example.org/owner",
      permissions: "Fixture",
      config: community ? {} : { owner: "huggingface", repo: "transformers" },
      state: "active",
    })
    .returning();
  return source;
}
async function addItem(sourceId: string, overrides: Partial<typeof sourceItems.$inferInsert> = {}) {
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId,
      externalId: "1",
      originalUrl: releaseUrl,
      canonicalUrl: releaseUrl,
      title: "Transformers v1.2.3",
      version: "v1.2.3",
      contentHash: "fixture",
      collectedAt: new Date("2026-01-02T00:00:00Z"),
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    })
    .returning();
  return item;
}

beforeAll(async () => {
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

describe("projeção editorial em PostgreSQL", () => {
  it("é idempotente inclusive com dois processadores concorrentes", async () => {
    const source = await addSource();
    await addItem(source.id);
    const results = await Promise.all([processPendingItems(db), processPendingItems(db)]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await processPendingItems(db)).toBe(0);
    expect(await db.select({ n: count() }).from(events)).toEqual([{ n: 1 }]);
    expect(await db.select({ n: count() }).from(eventSources)).toEqual([{ n: 1 }]);
    expect(await db.select({ n: count() }).from(eventVersions)).toEqual([{ n: 0 }]);
  });
  it("agrupa cobertura de URL/versão idênticas e promove só com fonte primária", async () => {
    const hn = await addSource(true);
    await addItem(hn.id, {
      version: null,
      discussionUrl: "https://news.ycombinator.com/item?id=1",
      title: "Transformers launch",
      publishedAt: new Date("2026-01-03T00:00:00Z"),
    });
    await processPendingItems(db);
    const [community] = await db.select().from(events);
    expect(community.editorialStatus).toBe("community_report");
    const primary = await addSource();
    await addItem(primary.id);
    await processPendingItems(db);
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      editorialStatus: "official_announcement",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      sortAt: community.sortAt,
      firstDiscoveredAt: community.firstDiscoveredAt,
    });
    expect(await db.select({ n: count() }).from(eventSources)).toEqual([{ n: 2 }]);
    expect(await db.select({ n: count() }).from(eventVersions)).toEqual([{ n: 1 }]);
  });
  it("não une versões distintas nem confirma automaticamente outra URL", async () => {
    const source = await addSource();
    await addItem(source.id);
    await addItem(source.id, {
      externalId: "2",
      version: "v2",
      originalUrl: releaseUrl.replace("v1.2.3", "v2"),
      canonicalUrl: releaseUrl.replace("v1.2.3", "v2"),
      title: "Transformers v2",
    });
    const hn = await addSource(true);
    await addItem(hn.id, {
      externalId: "3",
      version: null,
      originalUrl: "https://example.org/article",
      canonicalUrl: "https://example.org/article",
      title: "Transformers v1.2.3",
    });
    await processPendingItems(db);
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.editorialStatus === "community_report")).toHaveLength(1);
  });
  it("histórico preserva evidência anterior e ignora mudança de whitespace", async () => {
    const source = await addSource(true);
    const item = await addItem(source.id, {
      title: "OpenAI announces model",
      version: null,
      publishedAt: null,
    });
    await processPendingItems(db);
    const [before] = await db.select().from(events);
    await db
      .update(sourceItems)
      .set({ title: "OpenAI\n announces   model", processingState: "pending" })
      .where(eq(sourceItems.id, item.id));
    await processPendingItems(db);
    expect(await db.select({ n: count() }).from(eventVersions)).toEqual([{ n: 0 }]);
    await db
      .update(sourceItems)
      .set({ title: "OpenAI corrects model availability", processingState: "pending" })
      .where(eq(sourceItems.id, item.id));
    await processPendingItems(db);
    const [after] = await db.select().from(events);
    expect(after.firstDiscoveredAt).toEqual(before.firstDiscoveredAt);
    expect(after.sortAt).toEqual(before.sortAt);
    expect(after.publishedAt).toBeNull();
    const [version] = await db.select().from(eventVersions);
    expect(JSON.stringify(version.previousContent)).toContain("OpenAI announces model");
  });
  it("não publica itens removidos", async () => {
    const source = await addSource();
    await addItem(source.id, { processingState: "removed" });
    expect(await processPendingItems(db)).toBe(0);
    expect(await db.select({ n: count() }).from(events)).toEqual([{ n: 0 }]);
  });
  it("retag não deixa uma chave de v1 representar v2 nem mistura cobertura posterior de v1", async () => {
    const source = await addSource();
    const original = await addItem(source.id);
    await processPendingItems(db);
    const [before] = await db.select().from(events);
    const secondUrl = releaseUrl.replace("v1.2.3", "v2");
    await db
      .update(sourceItems)
      .set({
        originalUrl: secondUrl,
        canonicalUrl: secondUrl,
        version: "v2",
        title: "Transformers v2",
        processingState: "pending",
      })
      .where(eq(sourceItems.id, original.id));
    await processPendingItems(db);
    await addItem(source.id, { externalId: "another-release" });
    await processPendingItems(db);
    const all = await db.select().from(events);
    const old = all.find((event) => event.id === before.id)!;
    const next = all.find((event) => event.version === "v2")!;
    expect(old.version).toBe("v1.2.3");
    expect(next.sortAt).toEqual(before.sortAt);
    expect(next.firstDiscoveredAt).toEqual(before.firstDiscoveredAt);
    const [link] = await db
      .select()
      .from(eventSources)
      .where(eq(eventSources.sourceItemId, original.id));
    expect(link.eventId).toBe(next.id);
    expect(await db.select({ n: count() }).from(eventVersions)).toEqual([{ n: 2 }]);
  });
});
