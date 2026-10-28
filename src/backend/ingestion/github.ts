import { z } from "zod";
import type { Adapter, Batch, Cursor, JsonTransport } from "./contracts";
import { checkStatus } from "./errors";
import { canonicalizeUrl, withHash } from "./normalize";

const configSchema = z
  .object({
    owner: z.string().regex(/^[\w-]+$/),
    repo: z.string().regex(/^[\w.-]+$/),
    maxPages: z.number().int().min(1).max(3).default(2),
  })
  .strict();
const releaseSchema = z.object({
  id: z.number().int().positive(),
  html_url: z.string().url(),
  name: z.string().nullable(),
  tag_name: z.string().min(1),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.iso.datetime().nullable(),
});

export class GitHubReleasesAdapter implements Adapter {
  readonly capabilities = {
    incremental: "bounded-snapshot",
    conditional: true,
    deletions: false,
  } as const;
  private readonly config;
  constructor(
    config: unknown,
    private readonly transport: JsonTransport,
    private readonly token?: string,
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
    const release = releaseSchema.parse(input);
    if (release.draft) return null;
    const url = new URL(release.html_url);
    const prefix = `/${this.config.owner}/${this.config.repo}/releases/`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith(prefix)
    )
      throw new Error("Release fora do repositório configurado.");
    return withHash({
      externalId: String(release.id),
      originalUrl: canonicalizeUrl(release.html_url),
      canonicalUrl: canonicalizeUrl(release.html_url),
      discussionUrl: null,
      title: release.name?.trim() || release.tag_name,
      language: null,
      publishedAt: release.published_at ? new Date(release.published_at) : null,
      updatedAt: null,
      version: release.tag_name,
      prerelease: release.prerelease,
    });
  }
  async fetchSince(cursor: Cursor | null, signal: AbortSignal): Promise<Batch> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (cursor?.etag) headers["If-None-Match"] = cursor.etag;
    if (cursor?.lastModified) headers["If-Modified-Since"] = cursor.lastModified;
    const batch: Batch = { items: [], cursor: {}, quota: {}, notModified: false, truncated: false };
    const cutoff = Date.now() - 7 * 86400000;
    for (let page = 1; page <= this.config.maxPages; page++) {
      const response = await this.transport(
        `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/releases?per_page=30&page=${page}`,
        page === 1
          ? headers
          : Object.fromEntries(Object.entries(headers).filter(([key]) => !key.startsWith("If-"))),
        signal,
      );
      checkStatus(response.status, response.headers);
      batch.quota = {
        remaining: response.headers["x-ratelimit-remaining"] ?? null,
        reset: response.headers["x-ratelimit-reset"] ?? null,
        limit: response.headers["x-ratelimit-limit"] ?? null,
      };
      if (response.status === 304) return { ...batch, cursor: cursor ?? {}, notModified: true };
      const releases = z.array(releaseSchema).parse(response.body);
      for (const release of releases) {
        const item = this.normalize(release);
        if (item && (!item.publishedAt || item.publishedAt.getTime() >= cutoff))
          batch.items.push(item);
      }
      const hasNext = /rel="next"/.test(response.headers.link ?? "");
      // Releases não têm ordenação garantida por published_at: não parar em um item antigo.
      if (!hasNext) {
        if (page === 1)
          batch.cursor = {
            etag: response.headers.etag,
            lastModified: response.headers["last-modified"],
          };
        break;
      }
      if (page === this.config.maxPages) batch.truncated = true;
    }
    return batch;
  }
}
