ALTER TABLE "event_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "summary_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "topics" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "events_topics_idx" ON "events" USING gin ("topics");--> statement-breakpoint
CREATE INDEX "events_companies_idx" ON "events" USING gin ("companies");