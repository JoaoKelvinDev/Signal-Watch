import type { FeedItem } from "./feed";
export type EventDetail = {
  item: FeedItem;
  rationale: string;
  impact: string | null;
  history: { id: string; at: string; rationale: string; previousTitle: string | null }[];
};
