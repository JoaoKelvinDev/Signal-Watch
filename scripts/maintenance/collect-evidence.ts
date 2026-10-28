import { sql } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
const database = openDatabase();
try {
  const snapshot = await database.db.execute(sql`
    select s.slug, s.state, s.verified_at, s.last_success_at, s.last_error, s.quota,
      count(i.id)::int as stored_items
    from sources s left join source_items i on i.source_id = s.id
    group by s.id order by s.slug
  `);
  const runs = await database.db.execute(sql`
    select s.slug, r.started_at, r.finished_at, r.status, r.received, r.inserted, r.duplicates, r.error
    from ingestion_runs r join sources s on s.id = r.source_id
    order by r.started_at
  `);
  console.log(
    JSON.stringify(
      { recordedAt: new Date().toISOString(), sources: snapshot.rows, runs: runs.rows },
      null,
      2,
    ),
  );
} finally {
  await database.close();
}
