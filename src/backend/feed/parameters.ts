import { createHash } from "node:crypto";
import { z } from "zod";

const parameterSchema = z
  .object({
    tab: z.enum(["official", "community"]).default("official"),
    category: z.enum(["ai", "technology", "all"]).default("ai"),
    q: z.string().trim().max(120).default(""),
    source: z
      .string()
      .max(80)
      .regex(/^[a-z0-9-]*$/)
      .default(""),
    pageSize: z.coerce.number().int().min(1).max(30).default(12),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();

const cursorSchema = z
  .object({
    version: z.literal(1),
    // Seis casas preservam a precisão do PostgreSQL, inclusive registros antigos.
    at: z.iso.datetime({ precision: 6 }),
    id: z.uuid(),
    scope: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();

export type FeedParameters = z.infer<typeof parameterSchema>;
export type FeedCursor = z.infer<typeof cursorSchema>;

export class InvalidFeedParameters extends Error {
  constructor() {
    super("Parâmetros do feed inválidos.");
  }
}

export function filterScope(parameters: FeedParameters): string {
  const { tab, category, q, source, pageSize } = parameters;
  return createHash("sha256")
    .update(JSON.stringify({ tab, category, q, source, pageSize }))
    .digest("hex")
    .slice(0, 32);
}

export function encodeCursor(at: string, id: string, parameters: FeedParameters): string {
  const cursor = cursorSchema.parse({ version: 1, at, id, scope: filterScope(parameters) });
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(encoded: string, parameters: FeedParameters): FeedCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 2048) {
      throw new InvalidFeedParameters();
    }
    const buffer = Buffer.from(encoded, "base64url");
    if (buffer.toString("base64url") !== encoded) throw new InvalidFeedParameters();
    const cursor = cursorSchema.parse(JSON.parse(buffer.toString("utf8")) as unknown);
    if (cursor.scope !== filterScope(parameters)) throw new InvalidFeedParameters();
    return cursor;
  } catch {
    throw new InvalidFeedParameters();
  }
}

export function parseFeedParameters(search: URLSearchParams): FeedParameters {
  try {
    for (const key of search.keys()) {
      if (search.getAll(key).length !== 1) throw new InvalidFeedParameters();
    }
    const parameters = parameterSchema.parse(Object.fromEntries(search));
    if (parameters.cursor) decodeCursor(parameters.cursor, parameters);
    return parameters;
  } catch {
    throw new InvalidFeedParameters();
  }
}
