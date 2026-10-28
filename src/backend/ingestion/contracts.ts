export type Cursor = { etag?: string; lastModified?: string; seenIds?: number[] };
export type NormalizedItem = {
  externalId: string;
  originalUrl: string;
  canonicalUrl: string;
  discussionUrl: string | null;
  title: string;
  language: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  version: string | null;
  prerelease: boolean | null;
  contentHash: string;
};
export type Batch = {
  items: NormalizedItem[];
  cursor: Cursor;
  quota: Record<string, string | null>;
  notModified: boolean;
  truncated: boolean;
};
export type HttpResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: unknown;
};
export type JsonTransport = (
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<HttpResponse>;
export interface Adapter {
  capabilities: {
    incremental: "recent-window" | "bounded-snapshot";
    conditional: boolean;
    deletions: false;
  };
  validateConfig(config: unknown): void;
  healthCheck(signal: AbortSignal): Promise<void>;
  fetchSince(cursor: Cursor | null, signal: AbortSignal): Promise<Batch>;
  normalize(item: unknown): NormalizedItem | null;
}
