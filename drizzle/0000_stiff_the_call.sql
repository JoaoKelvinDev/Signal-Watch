CREATE TABLE "event_sources" (
	"event_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"role" text NOT NULL,
	"evidence_url" text NOT NULL,
	"claim" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"previous_content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"companies" text[] DEFAULT '{}'::text[] NOT NULL,
	"products" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" text,
	"summary" text,
	"impact" text,
	"type" text NOT NULL,
	"editorial_status" text NOT NULL,
	"rationale" text NOT NULL,
	"first_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"lease_token" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cursor" jsonb,
	"received" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"attempt" integer NOT NULL,
	"error" text,
	"status" text DEFAULT 'running' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"original_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"discussion_url" text,
	"title" text NOT NULL,
	"language" text,
	"excerpt" text,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"version" text,
	"prerelease" boolean,
	"processing_state" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"type" text NOT NULL,
	"editorial_level" text NOT NULL,
	"documentation_url" text NOT NULL,
	"ownership_url" text NOT NULL,
	"verified_at" timestamp with time zone,
	"permissions" text NOT NULL,
	"config" jsonb NOT NULL,
	"state" text DEFAULT 'unverified' NOT NULL,
	"interval_seconds" integer DEFAULT 900 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor" jsonb,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"quota" jsonb,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sources_interval_positive" CHECK ("sources"."interval_seconds" >= 60)
);
--> statement-breakpoint
CREATE TABLE "summary_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"result" jsonb NOT NULL,
	"tokens" integer,
	"cost_micros" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_versions" ADD CONSTRAINT "event_versions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_source_unique" ON "event_sources" USING btree ("event_id","source_item_id");--> statement-breakpoint
CREATE INDEX "event_source_item_idx" ON "event_sources" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "event_versions_event_idx" ON "event_versions" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "events" USING btree ("first_discovered_at");--> statement-breakpoint
CREATE INDEX "events_status_category_idx" ON "events" USING btree ("editorial_status","category");--> statement-breakpoint
CREATE INDEX "ingestion_source_time_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("state","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_open_per_source" ON "jobs" USING btree ("source_id") WHERE "jobs"."state" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "source_item_external_unique" ON "source_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "source_item_canonical_idx" ON "source_items" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "source_item_published_idx" ON "source_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "source_item_processing_idx" ON "source_items" USING btree ("processing_state");--> statement-breakpoint
CREATE INDEX "sources_due_idx" ON "sources" USING btree ("state","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "summary_cache_key" ON "summary_cache" USING btree ("input_hash","prompt_version","model");