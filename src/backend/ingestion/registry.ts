import type { Adapter, JsonTransport } from "./contracts";
import { GitHubReleasesAdapter } from "./github";
import { HackerNewsAdapter } from "./hacker-news";
import { getJson } from "./http";

export function makeAdapter(
  type: "github_releases" | "hacker_news",
  config: unknown,
  transport: JsonTransport = getJson,
): Adapter {
  if (type === "github_releases")
    return new GitHubReleasesAdapter(config, transport, process.env.GITHUB_TOKEN);
  return new HackerNewsAdapter(config, transport);
}
