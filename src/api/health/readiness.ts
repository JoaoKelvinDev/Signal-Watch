import { sql } from "drizzle-orm";
import { openDatabase } from "../../backend/database/client";

export async function GET() {
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    database = openDatabase();
    await database.db.execute(sql`select id from sources limit 0`);
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  } finally {
    await database?.close();
  }
}
