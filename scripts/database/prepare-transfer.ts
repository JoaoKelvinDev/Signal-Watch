import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";

// Exportação cliente → SQL com JSON em base64; conteúdo de notícias nunca vira código SQL.
// Somente origem local para evitar exportar outro projeto por engano.
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/radar_dev")
  throw new Error("A origem deve ser o radar_dev local.");
const database = openDatabase();
const tables = [
  "sources",
  "source_items",
  "events",
  "event_sources",
  "event_versions",
  "jobs",
  "ingestion_runs",
  "summary_cache",
] as const;
const statements: string[] = [
  "BEGIN;",
  `DO $radar$ BEGIN IF EXISTS (SELECT 1 FROM public.sources) OR EXISTS (SELECT 1 FROM public.events) THEN RAISE EXCEPTION 'Destino não está vazio'; END IF; END $radar$;`,
];
const counts: Record<string, number> = {};
try {
  await database.db.transaction(
    async (tx) => {
      const running = await tx.execute(sql`select 1 from jobs where state='running' limit 1`);
      if (running.rows.length)
        throw new Error("Aguarde a coleta terminar e pause o worker antes de exportar.");
      for (const table of tables) {
        // Nomes vêm exclusivamente da constante acima. JSON do PostgreSQL preserva timestamps com microssegundos.
        const result = await tx.execute<{ row: Record<string, unknown> }>(
          sql.raw(`select to_jsonb(t) as row from public.${table} t`),
        );
        const rows = result.rows.map((entry) => entry.row);
        counts[table] = rows.length;
        for (let offset = 0; offset < rows.length; offset += 20) {
          const encoded = Buffer.from(JSON.stringify(rows.slice(offset, offset + 20))).toString(
            "base64",
          );
          statements.push(
            `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb);`,
          );
        }
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  statements.push("COMMIT;");
  await mkdir(".local", { recursive: true });
  await writeFile(".local/supabase-transfer.sql", statements.join("\n"), "utf8");
  await writeFile(".local/supabase-transfer-counts.json", JSON.stringify(counts, null, 2), "utf8");
  console.log(JSON.stringify({ prepared: true, counts }));
} finally {
  await database.close();
}
