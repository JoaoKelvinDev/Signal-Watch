import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "../database/client";
import { events, eventSources, sourceItems, sources } from "../database/schema";
import type { FeedEvidence, FeedPage, FeedSourceStatus } from "../../shared/contracts/feed";
import { decodeCursor, encodeCursor, type FeedParameters } from "./parameters";
import { safeExternalUrl } from "./links";

const visibleEvidence = sql`exists (
  select 1 from event_sources es
  join source_items si on si.id = es.source_item_id
  where es.event_id = ${events.id} and si.processing_state <> 'removed'
)`;

const officialEvidence = sql`exists (
  select 1 from event_sources es
  join source_items si on si.id = es.source_item_id
  join sources s on s.id = si.source_id
  where es.event_id = ${events.id} and es.role = 'primary'
    and si.processing_state <> 'removed'
    and s.editorial_level = 'official' and s.verified_at is not null
)`;

const communityEvidence = sql`exists (
  select 1 from event_sources es
  join source_items si on si.id = es.source_item_id
  join sources s on s.id = si.source_id
  where es.event_id = ${events.id} and si.processing_state <> 'removed'
    and s.editorial_level = 'community'
)`;

// Ranking editorial simples: foco em IA (4), presença de origem primária (2), recência como desempate.
// Interesse não é inferido: o coletor não persiste votos. Ranking não é confirmação factual.
const relevance = sql<number>`(case when ${events.category} = 'ai' then 4 else 0 end + case when ${officialEvidence} then 2 else 0 end)`;

function searchCondition(query: string): SQL {
  return sql`(
    to_tsvector('simple', ${events.title}) @@ websearch_to_tsquery('simple', ${query})
    or exists (
      select 1 from event_sources es join source_items si on si.id = es.source_item_id
      where es.event_id = ${events.id} and si.processing_state <> 'removed'
        and to_tsvector('simple', si.title) @@ websearch_to_tsquery('simple', ${query})
    )
  )`;
}

export async function readFeed(db: Database, parameters: FeedParameters): Promise<FeedPage> {
  return db.transaction(
    async (tx) => {
      const filters: SQL[] = [visibleEvidence];
      if (parameters.tab === "official") filters.push(officialEvidence);
      else filters.push(sql`not (${officialEvidence}) and (${communityEvidence})`);
      if (parameters.category !== "all") filters.push(eq(events.category, parameters.category));
      if (parameters.q) filters.push(searchCondition(parameters.q));
      if (parameters.id) filters.push(eq(events.id, parameters.id));
      if (parameters.topic) filters.push(sql`${parameters.topic} = any(${events.topics})`);
      if (parameters.company) filters.push(sql`${parameters.company} = any(${events.companies})`);
      if (parameters.type) filters.push(eq(events.type, parameters.type));
      if (parameters.status) filters.push(eq(events.editorialStatus, parameters.status));
      if (parameters.from)
        filters.push(sql`${events.publishedAt} >= ${parameters.from}::timestamptz`);
      if (parameters.to) filters.push(sql`${events.publishedAt} <= ${parameters.to}::timestamptz`);
      if (parameters.language || parameters.origin)
        filters.push(sql`exists (
        select 1 from event_sources es join source_items si on si.id = es.source_item_id
        join sources s on s.id = si.source_id
        where es.event_id = ${events.id} and si.processing_state <> 'removed'
        ${parameters.language ? sql`and coalesce(si.language, 'unknown') = ${parameters.language}` : sql``}
        ${parameters.origin ? sql`and s.editorial_level = ${parameters.origin}` : sql``}
      )`);
      if (parameters.source) {
        filters.push(sql`exists (
        select 1 from event_sources es
        join source_items si on si.id = es.source_item_id
        join sources s on s.id = si.source_id
        where es.event_id = ${events.id} and si.processing_state <> 'removed'
          and s.slug = ${parameters.source}
      )`);
      }
      if (parameters.cursor) {
        const cursor = decodeCursor(parameters.cursor, parameters);
        const chronological = sql`(
        ${events.sortAt} < ${cursor.at}::timestamptz
        or (${events.sortAt} = ${cursor.at}::timestamptz and ${events.id} < ${cursor.id}::uuid)
      )`;
        filters.push(
          parameters.sort === "relevance"
            ? sql`(${relevance} < ${cursor.rank} or (${relevance} = ${cursor.rank} and ${chronological}))`
            : chronological,
        );
      }
      const records = await tx
        .select({
          event: events,
          rank: relevance,
          cursorTime: sql<string>`to_char(${events.sortAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(events)
        .where(and(...filters))
        .orderBy(
          ...(parameters.sort === "relevance" ? [desc(relevance)] : []),
          desc(events.sortAt),
          desc(events.id),
        )
        .limit(parameters.pageSize + 1);
      const page = records.slice(0, parameters.pageSize);
      const evidence = page.length
        ? await tx
            .select({
              eventId: eventSources.eventId,
              role: eventSources.role,
              verifiedAt: sources.verifiedAt,
              name: sources.name,
              slug: sources.slug,
              type: sources.type,
              editorialLevel: sources.editorialLevel,
              title: sourceItems.title,
              originalUrl: sourceItems.originalUrl,
              discussionUrl: sourceItems.discussionUrl,
              publishedAt: sourceItems.publishedAt,
              collectedAt: sourceItems.collectedAt,
              lastSuccessAt: sources.lastSuccessAt,
            })
            .from(eventSources)
            .innerJoin(sourceItems, eq(sourceItems.id, eventSources.sourceItemId))
            .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
            .where(
              and(
                inArray(
                  eventSources.eventId,
                  page.map(({ event }) => event.id),
                ),
                ne(sourceItems.processingState, "removed"),
              ),
            )
            .orderBy(
              sql`case when ${eventSources.role} = 'primary' then 0 else 1 end`,
              asc(sourceItems.collectedAt),
              asc(sourceItems.id),
            )
        : [];
      const byEvent = new Map<string, FeedEvidence[]>();
      const hasSafeOfficialEvidence = new Set<string>();
      for (const row of evidence) {
        const originalUrl = safeExternalUrl(row.originalUrl);
        if (!originalUrl) continue;
        if (
          row.role === "primary" &&
          row.editorialLevel === "official" &&
          row.verifiedAt !== null
        ) {
          hasSafeOfficialEvidence.add(row.eventId);
        }
        const list = byEvent.get(row.eventId) ?? [];
        list.push({
          name: row.name,
          slug: row.slug,
          type: row.type,
          editorialLevel: row.editorialLevel,
          title: row.title,
          originalUrl,
          discussionUrl: safeExternalUrl(row.discussionUrl),
          publishedAt: row.publishedAt?.toISOString() ?? null,
          collectedAt: row.collectedAt.toISOString(),
          lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        });
        byEvent.set(row.eventId, list);
      }
      const statuses = await tx
        .select({
          slug: sources.slug,
          name: sources.name,
          type: sources.type,
          editorialLevel: sources.editorialLevel,
          state: sources.state,
          lastSuccessAt: sources.lastSuccessAt,
          limited: sql<boolean>`${sources.lastError} = 'WINDOW_TRUNCATED'`,
        })
        .from(sources)
        .orderBy(asc(sources.slug));
      const sourceStatuses: FeedSourceStatus[] = statuses.map((source) => ({
        ...source,
        lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null,
        limited: source.limited === true,
      }));
      const last = page.at(-1);
      return {
        items: page.flatMap(({ event }) => {
          const eventEvidence = byEvent.get(event.id);
          if (!eventEvidence?.length || !["ai", "technology"].includes(event.category)) return [];
          if (parameters.tab === "official" && !hasSafeOfficialEvidence.has(event.id)) return [];
          return [
            {
              id: event.id,
              title: event.title,
              category: event.category as "ai" | "technology",
              type: event.type,
              editorialStatus:
                !hasSafeOfficialEvidence.has(event.id) &&
                event.editorialStatus === "official_announcement"
                  ? "community_report"
                  : event.editorialStatus,
              companies: event.companies,
              topics: event.topics,
              products: event.products,
              version: event.version,
              summary: event.summary,
              publishedAt: event.publishedAt?.toISOString() ?? null,
              discoveredAt: event.firstDiscoveredAt.toISOString(),
              lastChangedAt: event.lastChangedAt.toISOString(),
              sources: eventEvidence,
            },
          ];
        }),
        nextCursor:
          records.length > parameters.pageSize && last
            ? encodeCursor(
                last.cursorTime,
                last.event.id,
                parameters,
                parameters.sort === "relevance" ? last.rank : undefined,
              )
            : null,
        sources: sourceStatuses,
        generatedAt: new Date().toISOString(),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
