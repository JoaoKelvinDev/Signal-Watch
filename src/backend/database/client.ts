import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function openDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL é obrigatória no servidor.");
  const pool = new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 5000,
    options: "-c timezone=UTC",
  });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
export type Database = ReturnType<typeof openDatabase>["db"];
