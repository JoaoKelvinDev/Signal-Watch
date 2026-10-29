import { desc, eq } from "drizzle-orm";
import type { Database } from "../database/client";
import { events, eventVersions } from "../database/schema";
import type { EventDetail } from "../../shared/contracts/event";
import { readFeed } from "./repository";
import { parseFeedParameters } from "./parameters";

export async function readEvent(db: Database, id: string): Promise<EventDetail | null> {
  for (const tab of ["official", "community"] as const) {
    const feed = await readFeed(
      db,
      parseFeedParameters(new URLSearchParams({ id, category: "all", tab })),
    );
    const item = feed.items[0];
    if (!item) continue;
    const [record] = await db
      .select({ rationale: events.rationale, impact: events.impact })
      .from(events)
      .where(eq(events.id, id));
    if (!record) return null;
    const versions = await db
      .select()
      .from(eventVersions)
      .where(eq(eventVersions.eventId, id))
      .orderBy(desc(eventVersions.createdAt), desc(eventVersions.id))
      .limit(100);
    return {
      item,
      ...record,
      history: versions.map((version) => ({
        id: version.id,
        at: version.createdAt.toISOString(),
        rationale: version.rationale,
        previousTitle:
          version.previousContent &&
          typeof version.previousContent === "object" &&
          "title" in version.previousContent &&
          typeof version.previousContent.title === "string"
            ? version.previousContent.title
            : null,
      })),
    };
  }
  return null;
}
