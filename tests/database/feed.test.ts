import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
import { events, eventSources, sourceItems, sources } from "../../src/backend/database/schema";
import { readFeed } from "../../src/backend/feed/repository";
import { parseFeedParameters } from "../../src/backend/feed/parameters";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  process.env.ALLOW_DB_TESTS !== "1" ||
  !/^radar_test(?:_[a-z0-9]+)?$/.test(new URL(url).pathname.slice(1))
) {
  throw new Error("Use ALLOW_DB_TESTS=1 e TEST_DATABASE_URL de um banco radar_test descartável.");
}
const database = openDatabase(url);
const db = database.db;
let officialId: string;
let communityId: string;
const parameters = (query = "") => parseFeedParameters(new URLSearchParams(query));

async function addEvidence(
  eventId: string,
  sourceId: string,
  options: { title?: string; url?: string; removed?: boolean; primary?: boolean } = {},
) {
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId,
      externalId: randomUUID(),
      originalUrl: options.url ?? "https://example.org/release?v=1",
      canonicalUrl: options.url ?? "https://example.org/release?v=1",
      discussionUrl: sourceId === communityId ? "https://news.ycombinator.com/item?id=123" : null,
      title: options.title ?? "Transformers 1.2.3 release original",
      contentHash: "fixture",
      publishedAt: null,
      processingState: options.removed ? "removed" : "processed",
    })
    .returning();
  await db.insert(eventSources).values({
    eventId,
    sourceItemId: item.id,
    role: options.primary ? "primary" : "discovery",
    evidenceUrl: item.originalUrl,
    claim: item.title,
  });
  return item;
}

async function addEvent(
  options: {
    id?: string;
    sourceId?: string;
    category?: string;
    title?: string;
    publishedAt?: Date | null;
    noEvidence?: boolean;
    unsafe?: boolean;
  } = {},
) {
  const sourceId = options.sourceId ?? officialId;
  const [event] = await db
    .insert(events)
    .values({
      id: options.id,
      dedupKey: randomUUID(),
      title: options.title ?? "Atualização de SDK",
      category: options.category ?? "ai",
      companies: ["Hugging Face"],
      products: ["Transformers"],
      type: sourceId === officialId ? "release" : "discussion",
      editorialStatus: sourceId === officialId ? "official_announcement" : "community_report",
      rationale: "Fixture isolada",
      publishedAt: options.publishedAt ?? null,
      sortAt: sql`'2026-10-28 12:00:00.123456+00'::timestamptz`,
    })
    .returning();
  if (!options.noEvidence)
    await addEvidence(event.id, sourceId, {
      primary: sourceId === officialId,
      url: options.unsafe ? "javascript:alert(1)" : undefined,
    });
  return event;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate event_sources, event_versions, events, source_items, ingestion_runs, jobs, sources, summary_cache`,
  );
  const [official, community] = await db
    .insert(sources)
    .values([
      {
        slug: "official-fixture",
        name: "Fonte oficial",
        domain: "example.org",
        type: "github_releases",
        editorialLevel: "official",
        verifiedAt: new Date(),
        documentationUrl: "https://example.org/docs",
        ownershipUrl: "https://example.org/owner",
        permissions: "fixture",
        config: { privateSetting: "never-exposed" },
        state: "active",
        lastSuccessAt: new Date(),
        lastError: "WINDOW_TRUNCATED",
      },
      {
        slug: "community-fixture",
        name: "Fonte comunitária",
        domain: "news.ycombinator.com",
        type: "hacker_news",
        editorialLevel: "community",
        verifiedAt: new Date(),
        documentationUrl: "https://example.org/docs",
        ownershipUrl: "https://example.org/owner",
        permissions: "fixture",
        config: {},
        state: "active",
      },
    ])
    .returning();
  officialId = official.id;
  communityId = community.id;
});
afterAll(async () => {
  await database.close();
});

describe("feed consultado em PostgreSQL real", () => {
  it("pagina datas empatadas sem repetir ou pular microssegundos", async () => {
    const ids = [1, 3, 2].map(
      (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`,
    );
    for (const id of ids) await addEvent({ id });
    const visited: string[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ pageSize: "1" });
      if (cursor) query.set("cursor", cursor);
      const page = await readFeed(db, parseFeedParameters(query));
      visited.push(...page.items.map((event) => event.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(visited).toEqual([...ids].sort().reverse());
  });
  it("busca título original da evidência sem fabricar resumo ou publicação", async () => {
    await addEvent({ title: "Lançamento de biblioteca" });
    const page = await readFeed(db, parameters("q=transformers"));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      title: "Lançamento de biblioteca",
      summary: null,
      publishedAt: null,
    });
    expect(page.items[0].sources[0]).toMatchObject({
      title: "Transformers 1.2.3 release original",
      originalUrl: "https://example.org/release?v=1",
      publishedAt: null,
    });
  });
  it("aplica categoria e fonte preservando a separação de comunidade", async () => {
    await addEvent();
    const community = await addEvent({ sourceId: communityId, category: "technology" });
    expect((await readFeed(db, parameters())).items).toHaveLength(1);
    expect((await readFeed(db, parameters("tab=community"))).items).toHaveLength(0);
    expect(
      (
        await readFeed(db, parameters("tab=community&category=technology&source=community-fixture"))
      ).items.map((item) => item.id),
    ).toEqual([community.id]);
    expect((await readFeed(db, parameters("source=community-fixture"))).items).toHaveLength(0);
  });
  it("fontes temporariamente indisponíveis mantêm evidência oficial já verificada", async () => {
    await addEvent();
    await db.update(sources).set({ state: "unavailable" }).where(eq(sources.id, officialId));
    const page = await readFeed(db, parameters());
    expect(page.items).toHaveLength(1);
    expect(page.sources.find((source) => source.slug === "official-fixture")).toMatchObject({
      state: "unavailable",
      limited: true,
    });
    expect(JSON.stringify(page)).not.toContain("never-exposed");
    expect(page.sources[0]).not.toHaveProperty("config");
  });
  it("exclui removidos e eventos sem evidência; remoção da primária retira anúncio oficial", async () => {
    await addEvent({ noEvidence: true });
    const removed = await addEvent({ noEvidence: true });
    await addEvidence(removed.id, officialId, { removed: true, primary: true });
    const formerlyOfficial = await addEvent({ noEvidence: true });
    await addEvidence(formerlyOfficial.id, officialId, { removed: true, primary: true });
    await addEvidence(formerlyOfficial.id, communityId);
    expect((await readFeed(db, parameters())).items).toHaveLength(0);
    const community = await readFeed(db, parameters("tab=community"));
    expect(community.items).toHaveLength(1);
    expect(community.items[0]).toMatchObject({
      id: formerlyOfficial.id,
      editorialStatus: "community_report",
    });
    expect(community.items[0].sources).toHaveLength(1);
  });
  it("não oferece links executáveis nem confirma evento sem primária utilizável", async () => {
    const event = await addEvent({ unsafe: true });
    await addEvidence(event.id, communityId);
    expect((await readFeed(db, parameters())).items).toHaveLength(0);
  });
  it("exige verificação e papel de primária, não apenas editorialLevel official", async () => {
    const event = await addEvent({ noEvidence: true });
    await addEvidence(event.id, officialId, { primary: false });
    expect((await readFeed(db, parameters())).items).toHaveLength(0);
    await db
      .update(eventSources)
      .set({ role: "primary" })
      .where(eq(eventSources.eventId, event.id));
    await db.update(sources).set({ verifiedAt: null }).where(eq(sources.id, officialId));
    expect((await readFeed(db, parameters())).items).toHaveLength(0);
  });
  it("trata texto com sintaxe SQL como pesquisa parametrizada", async () => {
    await addEvent();
    const page = await readFeed(
      db,
      parameters("q=" + encodeURIComponent("'; DROP TABLE sources; --")),
    );
    expect(page.items).toHaveLength(0);
    expect((await db.select().from(sources)).length).toBe(2);
  });
});
