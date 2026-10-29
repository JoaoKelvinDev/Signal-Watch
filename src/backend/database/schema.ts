import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import type { Cursor } from "../ingestion/contracts";

const utc = (name: string) => timestamp(name, { withTimezone: true });

export const sources = pgTable(
  "sources",
  {
    id: uuid().defaultRandom().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    domain: text().notNull(),
    type: text({ enum: ["github_releases", "hacker_news"] }).notNull(),
    editorialLevel: text("editorial_level", { enum: ["official", "community"] }).notNull(),
    documentationUrl: text("documentation_url").notNull(),
    ownershipUrl: text("ownership_url").notNull(),
    verifiedAt: utc("verified_at"),
    permissions: text().notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    state: text({
      enum: [
        "unverified",
        "active",
        "blocked",
        "unavailable",
        "pending_credentials",
        "pending_approval",
        "paused",
      ],
    })
      .notNull()
      .default("unverified"),
    intervalSeconds: integer("interval_seconds").notNull().default(900),
    nextRunAt: utc("next_run_at").notNull().defaultNow(),
    cursor: jsonb().$type<Cursor>(),
    lastAttemptAt: utc("last_attempt_at"),
    lastSuccessAt: utc("last_success_at"),
    lastError: text("last_error"),
    quota: jsonb().$type<Record<string, string | null>>(),
  },
  (t) => [
    index("sources_due_idx").on(t.state, t.nextRunAt),
    check("sources_interval_positive", sql`${t.intervalSeconds} >= 60`),
  ],
).enableRLS();

export const sourceItems = pgTable(
  "source_items",
  {
    id: uuid().defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id").notNull(),
    originalUrl: text("original_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    discussionUrl: text("discussion_url"),
    title: text().notNull(),
    language: text(),
    excerpt: text(),
    publishedAt: utc("published_at"),
    updatedAt: utc("updated_at"),
    collectedAt: utc("collected_at").notNull().defaultNow(),
    lastSeenAt: utc("last_seen_at").notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
    version: text(),
    prerelease: boolean(),
    processingState: text("processing_state", { enum: ["pending", "processed", "removed"] })
      .notNull()
      .default("pending"),
  },
  (t) => [
    uniqueIndex("source_item_external_unique").on(t.sourceId, t.externalId),
    index("source_item_canonical_idx").on(t.canonicalUrl),
    index("source_item_published_idx").on(t.publishedAt),
    index("source_item_processing_idx").on(t.processingState),
    index("source_item_title_search_idx").using("gin", sql`to_tsvector('simple', ${t.title})`),
  ],
).enableRLS();

export const events = pgTable(
  "events",
  {
    id: uuid().defaultRandom().primaryKey(),
    dedupKey: text("dedup_key").notNull(),
    title: text().notNull(),
    category: text().notNull(),
    companies: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    topics: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    products: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: text(),
    summary: text(),
    impact: text(),
    type: text().notNull(),
    editorialStatus: text("editorial_status").notNull(),
    rationale: text().notNull(),
    publishedAt: utc("published_at"),
    sortAt: utc("sort_at").notNull().defaultNow(),
    firstDiscoveredAt: utc("first_discovered_at").notNull().defaultNow(),
    lastChangedAt: utc("last_changed_at").notNull().defaultNow(),
  },
  (t) => [
    index("events_topics_idx").using("gin", t.topics),
    index("events_companies_idx").using("gin", t.companies),
    index("events_date_idx").on(t.firstDiscoveredAt),
    uniqueIndex("events_dedup_key_unique").on(t.dedupKey),
    index("events_sort_idx").on(t.sortAt, t.id),
    index("events_title_search_idx").using("gin", sql`to_tsvector('simple', ${t.title})`),
    index("events_status_category_idx").on(t.editorialStatus, t.category),
  ],
).enableRLS();

export const eventSources = pgTable(
  "event_sources",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => sourceItems.id),
    role: text().notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    claim: text().notNull(),
  },
  (t) => [
    uniqueIndex("event_source_unique").on(t.eventId, t.sourceItemId),
    index("event_source_item_idx").on(t.sourceItemId),
  ],
).enableRLS();

export const eventVersions = pgTable(
  "event_versions",
  {
    id: uuid().defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    previousContent: jsonb("previous_content").notNull(),
    contentHash: text("content_hash").notNull(),
    rationale: text().notNull(),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (t) => [index("event_versions_event_idx").on(t.eventId, t.createdAt)],
).enableRLS();

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    priority: integer().notNull().default(0),
    state: text({ enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    leaseToken: uuid("lease_token"),
    leaseUntil: utc("lease_until"),
    runAfter: utc("run_after").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_ready_idx").on(t.state, t.runAfter),
    uniqueIndex("jobs_one_open_per_source")
      .on(t.sourceId)
      .where(sql`${t.state} in ('pending', 'running')`),
  ],
).enableRLS();

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid().defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    leaseToken: uuid("lease_token").notNull(),
    startedAt: utc("started_at").notNull().defaultNow(),
    finishedAt: utc("finished_at"),
    cursor: jsonb().$type<Cursor>(),
    received: integer().notNull().default(0),
    inserted: integer().notNull().default(0),
    duplicates: integer().notNull().default(0),
    attempt: integer().notNull(),
    error: text(),
    status: text({ enum: ["running", "success", "retry", "failed", "abandoned"] })
      .notNull()
      .default("running"),
  },
  (t) => [index("ingestion_source_time_idx").on(t.sourceId, t.startedAt)],
).enableRLS();

export const summaryCache = pgTable(
  "summary_cache",
  {
    id: uuid().defaultRandom().primaryKey(),
    inputHash: text("input_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text().notNull(),
    result: jsonb().notNull(),
    tokens: integer(),
    costMicros: integer("cost_micros"),
    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("summary_cache_key").on(t.inputHash, t.promptVersion, t.model)],
).enableRLS();
