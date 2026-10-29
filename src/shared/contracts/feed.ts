export type FeedSourceStatus = {
  slug: string;
  name: string;
  type: "github_releases" | "hacker_news";
  editorialLevel: "official" | "community";
  state: string;
  lastSuccessAt: string | null;
  limited: boolean;
};

export type FeedEvidence = {
  name: string;
  slug: string;
  type: "github_releases" | "hacker_news";
  editorialLevel: "official" | "community";
  title: string;
  originalUrl: string;
  discussionUrl: string | null;
  publishedAt: string | null;
  collectedAt: string;
  lastSuccessAt: string | null;
};

export type FeedItem = {
  id: string;
  title: string;
  category: "ai" | "technology";
  type: string;
  editorialStatus: string;
  companies: string[];
  topics: string[];
  products: string[];
  version: string | null;
  summary: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  lastChangedAt: string;
  sources: FeedEvidence[];
};

export type FeedPage = {
  items: FeedItem[];
  nextCursor: string | null;
  sources: FeedSourceStatus[];
  generatedAt: string;
};
