import { eq } from "drizzle-orm";
import { openDatabase } from "../../src/backend/database/client";
import { sources } from "../../src/backend/database/schema";
import { sourceCatalog } from "../../src/backend/database/source-catalog";
import { makeAdapter } from "../../src/backend/ingestion/registry";
import { IngestionError, safeError } from "../../src/backend/ingestion/errors";
import { isDeepStrictEqual } from "node:util";

// Rede real, opt-in pelo comando separado. --activate somente em banco configurado pelo operador.
const activate = process.argv.includes("--activate");
const database = activate ? openDatabase() : null;
let failed = false;
try {
  for (const source of sourceCatalog) {
    try {
      if (database) {
        const [stored] = await database.db
          .select()
          .from(sources)
          .where(eq(sources.slug, source.slug));
        if (
          !stored ||
          stored.type !== source.type ||
          !isDeepStrictEqual(stored.config, source.config)
        )
          throw new IngestionError("CONFIG_NOT_CATALOGUED", true);
      }
      const batch = await makeAdapter(source.type, source.config).fetchSince(
        null,
        AbortSignal.timeout(90000),
      );
      console.log(
        JSON.stringify({
          source: source.slug,
          checkedAt: new Date().toISOString(),
          status: "success",
          normalizedItems: batch.items.length,
          truncated: batch.truncated,
          quota: batch.quota,
        }),
      );
      if (database) {
        const result = await database.db
          .update(sources)
          .set({ state: "active", verifiedAt: new Date(), lastError: null })
          .where(eq(sources.slug, source.slug))
          .returning({ id: sources.id });
        if (!result.length) throw new Error("Execute db:seed primeiro.");
      }
    } catch (error) {
      failed = true;
      console.log(
        JSON.stringify({
          source: source.slug,
          checkedAt: new Date().toISOString(),
          status: "failed",
          error: safeError(error).code,
        }),
      );
      if (database)
        await database.db
          .update(sources)
          .set({ state: "unavailable", lastError: safeError(error).code })
          .where(eq(sources.slug, source.slug));
    }
  }
} finally {
  await database?.close();
}
if (failed) process.exitCode = 1;
