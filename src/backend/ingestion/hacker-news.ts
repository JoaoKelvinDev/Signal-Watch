import { z } from "zod";
import type { Adapter, Batch, Cursor, JsonTransport } from "./contracts";
import { checkStatus } from "./errors";
import { canonicalizeUrl, withHash } from "./normalize";

const configSchema = z.object({ maxItems: z.number().int().min(1).max(30).default(25) }).strict();
const itemSchema = z.object({
  id: z.number().int().positive(),
  type: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  time: z.number().int().nonnegative().optional(),
  deleted: z.boolean().optional(),
  dead: z.boolean().optional(),
});

export class HackerNewsAdapter implements Adapter {
  readonly capabilities = {
    incremental: "recent-window",
    conditional: false,
    deletions: false,
  } as const;
  private readonly config;
  constructor(
    config: unknown,
    private readonly transport: JsonTransport,
  ) {
    this.config = configSchema.parse(config);
  }
  validateConfig(config: unknown) {
    configSchema.parse(config);
  }
  async healthCheck(signal: AbortSignal) {
    await this.fetchSince(null, signal);
  }
  normalize(input: unknown) {
    const item = itemSchema.parse(input);
    if (item.deleted || item.dead || item.type !== "story" || !item.title?.trim()) return null;
    const discussionUrl = `https://news.ycombinator.com/item?id=${item.id}`;
    let originalUrl: string;
    try {
      originalUrl = canonicalizeUrl(item.url || discussionUrl);
    } catch {
      return null;
    }
    return withHash({
      externalId: String(item.id),
      originalUrl,
      canonicalUrl: originalUrl,
      discussionUrl,
      title: item.title,
      language: null,
      publishedAt: item.time === undefined ? null : new Date(item.time * 1000),
      updatedAt: null,
      version: null,
      prerelease: null,
    });
  }
  async fetchSince(cursor: Cursor | null, signal: AbortSignal): Promise<Batch> {
    const response = await this.transport(
      "https://hacker-news.firebaseio.com/v0/newstories.json",
      {},
      signal,
    );
    checkStatus(response.status, response.headers);
    const ids = z.array(z.number().int().positive()).max(1000).parse(response.body);
    const seen = new Set(cursor?.seenIds ?? []);
    const pending = ids.filter((id) => !seen.has(id));
    // Primeiro ciclo: últimas N histórias. Nos seguintes, consumir as pendentes mais antigas da janela.
    const selected = cursor
      ? pending.slice(-this.config.maxItems).reverse()
      : pending.slice(0, this.config.maxItems);
    if (!cursor) for (const id of ids.slice(this.config.maxItems)) seen.add(id);
    const items: Batch["items"] = [];
    for (const id of selected) {
      const detail = await this.transport(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        {},
        signal,
      );
      checkStatus(detail.status, detail.headers);
      if (detail.body !== null) {
        const parsed = itemSchema.parse(detail.body);
        if (parsed.id !== id) throw new Error("ID divergente na API do HN.");
        const item = this.normalize(parsed);
        if (item && (!item.publishedAt || item.publishedAt.getTime() >= Date.now() - 7 * 86400000))
          items.push(item);
      }
      seen.add(id);
    }
    return {
      items,
      cursor: { seenIds: ids.filter((id) => seen.has(id)) },
      quota: {},
      notModified: false,
      truncated: cursor !== null && pending.length > selected.length,
    };
  }
}
