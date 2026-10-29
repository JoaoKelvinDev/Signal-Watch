import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { databaseConfig } from "./config";

export function openDatabase(url = process.env.DATABASE_URL) {
  const pool = new Pool(databaseConfig(url));
  pool.on("error", () => console.error("DATABASE_IDLE_CONNECTION_INTERRUPTED"));
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
export type Database = ReturnType<typeof openDatabase>["db"];
