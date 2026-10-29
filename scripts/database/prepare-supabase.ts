import { mkdir, writeFile } from "node:fs/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";

// Bootstrap exclusivo para um projeto Supabase sem tabelas do Radar.
// Mantém o ledger do Drizzle: futuras migrações continuam pelo comando db:migrate.
const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const tables = [
  "sources",
  "source_items",
  "events",
  "event_sources",
  "event_versions",
  "jobs",
  "ingestion_runs",
  "summary_cache",
];
const guards = tables
  .map(
    (table) =>
      `IF to_regclass('public.${table}') IS NOT NULL THEN RAISE EXCEPTION 'O destino já contém tabelas do Radar'; END IF;`,
  )
  .join("\n");
const sql = [
  `DO $radar$ BEGIN ${guards} IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN RAISE EXCEPTION 'O destino já contém um ledger Drizzle'; END IF; END $radar$;`,
  `CREATE SCHEMA IF NOT EXISTS drizzle;`,
  `REVOKE ALL ON SCHEMA drizzle FROM PUBLIC, anon, authenticated;`,
  `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);`,
  ...migrations.flatMap((migration) => [
    ...migration.sql,
    `INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ('${migration.hash}', ${migration.folderMillis});`,
  ]),
  `REVOKE ALL ON TABLE ${tables.map((table) => `public.${table}`).join(", ")} FROM anon, authenticated;`,
].join("\n");
await mkdir(".local", { recursive: true });
await writeFile(".local/supabase-bootstrap.sql", sql, "utf8");
console.log(
  `Bootstrap preparado: ${migrations.length} migrações. Revise antes de aplicar; não execute em banco existente.`,
);
