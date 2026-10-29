import { sql } from "drizzle-orm";
import { getRequestDatabase } from "../../backend/database/request-client";
import { createFeedLimiter } from "../feed/rate-limit";
const allowReadinessRequest = createFeedLimiter(60);

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!allowReadinessRequest())
    return Response.json(
      { status: "rate_limited" },
      { status: 429, headers: { ...headers, "Retry-After": "60" } },
    );
  try {
    const db = getRequestDatabase();
    await db.execute(sql`select id from sources limit 0`);
    return Response.json({ status: "ready" }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
