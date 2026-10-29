export type AdminAction =
  | { action: "login"; password: string }
  | { action: "logout" }
  | {
      action: "create";
      slug: string;
      name: string;
      owner: string;
      repo: string;
      ownershipUrl: string;
      permissions: string;
      intervalSeconds: number;
    }
  | { action: "verify"; id: string; reviewed: true }
  | { action: "source"; id: string; enabled: boolean; intervalSeconds: number }
  | { action: "reprocess"; id: string; after?: string };

export type AdminDashboard = {
  sources: {
    id: string;
    name: string;
    ownershipUrl: string;
    documentationUrl: string;
    permissions: string;
    type: string;
    state: string;
    verifiedAt: string | null;
    intervalSeconds: number;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    quota: Record<string, string | null> | null;
  }[];
  runs: {
    sourceId: string;
    startedAt: string;
    finishedAt: string | null;
    received: number;
    inserted: number;
    duplicates: number;
    status: string;
    error: string | null;
  }[];
  queue: { state: string; count: number }[];
};
