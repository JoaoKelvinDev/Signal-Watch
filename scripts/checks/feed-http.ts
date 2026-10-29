import assert from "node:assert/strict";
import type { FeedPage } from "../../src/shared/contracts/feed";

const target = new URL(process.env.RADAR_BASE_URL ?? "http://127.0.0.1:3000");
assert.ok(
  target.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(target.hostname) &&
    !target.username &&
    !target.password,
  "A verificação HTTP deve apontar para o site local, sem credenciais na URL.",
);
const base = target.origin;
async function read(params = ""): Promise<FeedPage> {
  const response = await fetch(`${base}/api/feed${params ? `?${params}` : ""}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json() as Promise<FeedPage>;
}

const official = await read();
assert.ok(
  official.items.length > 0,
  "O teste HTTP precisa de ao menos um anúncio oficial real já coletado.",
);
const first = official.items[0];
assert.equal(first.editorialStatus, "official_announcement");
assert.ok(first.sources.some((source) => source.editorialLevel === "official"));
const term = first.products[0] ?? first.title.match(/[\p{L}\p{N}]+/u)?.[0];
assert.ok(term);
const search = await read(`q=${encodeURIComponent(term)}`);
assert.ok(search.items.some((item) => item.id === first.id));
const source = first.sources.find((entry) => entry.editorialLevel === "official")!;
const filtered = await read(`source=${encodeURIComponent(source.slug)}`);
assert.ok(filtered.items.some((item) => item.id === first.id));

const community = await read("tab=community&category=all&pageSize=5");
const ids = new Set<string>();
let page = community;
let pages = 0;
let links = 0;
do {
  for (const item of page.items) {
    assert.equal(item.editorialStatus, "community_report");
    assert.ok(!ids.has(item.id), "Paginação repetiu evento.");
    ids.add(item.id);
    for (const evidence of item.sources) {
      const original = new URL(evidence.originalUrl);
      assert.ok(["http:", "https:"].includes(original.protocol));
      assert.equal(original.username, "");
      assert.equal(original.password, "");
      if (evidence.type === "hacker_news") {
        assert.ok(evidence.discussionUrl);
        assert.equal(new URL(evidence.discussionUrl).hostname, "news.ycombinator.com");
      }
      links++;
    }
  }
  pages++;
  if (!page.nextCursor) break;
  assert.ok(pages < 30, "Paginação excedeu limite de segurança do teste.");
  page = await read(
    `tab=community&category=all&pageSize=5&cursor=${encodeURIComponent(page.nextCursor)}`,
  );
} while (true);
assert.ok(ids.size > 5, "O teste precisa de mais de uma página real de comunidade.");
assert.equal((await fetch(`${base}/api/feed?cursor=invalid`)).status, 400);
assert.equal((await fetch(`${base}/api/feed?unknown=1`)).status, 400);
assert.equal((await fetch(`${base}/api/health/ready`)).status, 200);
const html = await (await fetch(base)).text();
assert.match(html, /<html[^>]+lang="pt-BR"/);
assert.match(html, /<main[^>]+id="noticias"/);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      status: "success",
      officialItems: official.items.length,
      communityItems: ids.size,
      communityPages: pages,
      linksValidated: links,
      search: term,
      filters: "passed",
      invalidParameters: "400",
      readiness: "200",
    },
    null,
    2,
  ),
);
