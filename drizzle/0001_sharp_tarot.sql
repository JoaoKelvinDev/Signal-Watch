ALTER TABLE "events" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sort_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "events" SET "dedup_key" = 'legacy:' || "id"::text, "sort_at" = "first_discovered_at";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_dedup_key_unique" ON "events" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "events_sort_idx" ON "events" USING btree ("sort_at","id");--> statement-breakpoint
CREATE INDEX "events_title_search_idx" ON "events" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE INDEX "source_item_title_search_idx" ON "source_items" USING gin (to_tsvector('simple', "title"));
