import { describe, expect, it } from "vitest";
import { GitHubReleasesAdapter } from "../../src/backend/ingestion/github";
import { HackerNewsAdapter } from "../../src/backend/ingestion/hacker-news";
import type { JsonTransport, HttpResponse } from "../../src/backend/ingestion/contracts";
import { IngestionError, retryDelay, safeError } from "../../src/backend/ingestion/errors";
import { canonicalizeUrl } from "../../src/backend/ingestion/normalize";
import { isPublicIPv4, validateTransportUrl } from "../../src/backend/ingestion/http";

const signal = () => AbortSignal.timeout(5000);
const release = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Transformers v1.2.3",
  tag_name: "v1.2.3",
  draft: false,
  prerelease: false,
  html_url: "https://github.com/huggingface/transformers/releases/tag/v1.2.3",
  published_at: new Date().toISOString(),
  ...overrides,
});
const response = (body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
  status: 200,
  headers,
  body,
});
const gh = (transport: JsonTransport, maxPages = 2) =>
  new GitHubReleasesAdapter({ owner: "huggingface", repo: "transformers", maxPages }, transport);

describe("GitHub Releases", () => {
  it("preserva versão, prerelease e publicação nula; não transforma tag em release", async () => {
    const batch = await gh(async () =>
      response([
        release({ published_at: null, prerelease: true, body: "<script>roubar()</script>" }),
        release({ id: 2, draft: true }),
      ]),
    ).fetchSince(null, signal());
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({
      version: "v1.2.3",
      prerelease: true,
      publishedAt: null,
      updatedAt: null,
      language: null,
    });
    expect(batch.items[0]).not.toHaveProperty("body");
  });
  it("rejeita mudança de esquema e link de outro projeto", async () => {
    await expect(
      gh(async () => response([{ tag_name: "v1" }])).fetchSince(null, signal()),
    ).rejects.toThrow();
    expect(() =>
      gh(async () => response([])).normalize(
        release({ html_url: "https://github.com/outro/projeto/releases/tag/v1" }),
      ),
    ).toThrow();
  });
  it("trata 304 como sucesso sem apagar cursor", async () => {
    const cursor = { etag: '"abc"' };
    const batch = await gh(async (_url, headers) => {
      expect(headers["If-None-Match"]).toBe(cursor.etag);
      return { status: 304, headers: {}, body: null };
    }).fetchSince(cursor, signal());
    expect(batch).toMatchObject({ items: [], cursor, notModified: true });
  });
  it("pagina até o limite; não guarda ETag parcial", async () => {
    const calls: string[] = [];
    const batch = await gh(async (url) => {
      calls.push(url);
      return response([release({ id: calls.length })], {
        link: '<https://api.github.com/ignored>; rel="next"',
        etag: '"partial"',
      });
    }).fetchSince(null, signal());
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("page=2");
    expect(batch).toMatchObject({ truncated: true, cursor: {} });
  });
  it("não interrompe paginação ao encontrar publicação antiga", async () => {
    let call = 0;
    const batch = await gh(async () =>
      ++call === 1
        ? response([release({ published_at: "2000-01-01T00:00:00Z" })], { link: 'x; rel="next"' })
        : response([release({ id: 2 })]),
    ).fetchSince(null, signal());
    expect(batch.items.map((item) => item.externalId)).toEqual(["2"]);
  });
  it.each([401, 403])("bloqueia HTTP %s", async (status) => {
    await expect(
      gh(async () => ({ status, headers: {}, body: null })).fetchSince(null, signal()),
    ).rejects.toMatchObject({ blocked: true, code: `HTTP_${status}` });
  });
  it("respeita Retry-After de 429 e reset de 403 com quota esgotada", async () => {
    await expect(
      gh(async () => ({ status: 429, headers: { "retry-after": "120" }, body: null })).fetchSince(
        null,
        signal(),
      ),
    ).rejects.toMatchObject({ blocked: false, retryAfterMs: 120000 });
    await expect(
      gh(async () => ({
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 600),
        },
        body: null,
      })).fetchSince(null, signal()),
    ).rejects.toMatchObject({ blocked: false, code: "RATE_LIMIT" });
  });
});

describe("Hacker News", () => {
  it("mantém discussão separada da URL original, sem texto nem autor", async () => {
    const adapter = new HackerNewsAdapter({ maxItems: 1 }, async (url) =>
      url.includes("newstories")
        ? response([11, 10])
        : response({
            id: 11,
            type: "story",
            title: "Um modelo",
            url: "https://example.org/artigo?utm_source=hn&version=2",
            text: "instruções maliciosas",
            by: "autor",
          }),
    );
    const batch = await adapter.fetchSince(null, signal());
    expect(batch.items[0]).toMatchObject({
      publishedAt: null,
      originalUrl: "https://example.org/artigo?version=2",
      discussionUrl: "https://news.ycombinator.com/item?id=11",
    });
    expect(batch.items[0]).not.toHaveProperty("text");
    expect(batch.items[0]).not.toHaveProperty("by");
    expect(batch.cursor.seenIds).toEqual([11, 10]);
  });
  it("consome backlog limitado sem pular IDs ainda não persistidos", async () => {
    const calls: string[] = [];
    const adapter = new HackerNewsAdapter({ maxItems: 1 }, async (url) => {
      calls.push(url);
      return url.includes("newstories")
        ? response([13, 12, 11])
        : response({ id: 12, type: "story", title: "Teste" });
    });
    const batch = await adapter.fetchSince({ seenIds: [11] }, signal());
    expect(calls[1]).toContain("item/12.json");
    expect(batch.cursor.seenIds).toEqual([12, 11]);
    expect(batch.truncated).toBe(true);
  });
  it("tolera item ausente/removido e não gera notícia de comentário", async () => {
    const adapter = new HackerNewsAdapter({}, async () => response([]));
    expect(adapter.normalize({ id: 1, deleted: true })).toBeNull();
    expect(adapter.normalize({ id: 2, type: "comment", title: "não é notícia" })).toBeNull();
    expect(
      adapter.normalize({
        id: 3,
        type: "story",
        title: "link malicioso",
        url: "javascript:alert(1)",
      }),
    ).toBeNull();
    const absent = new HackerNewsAdapter({}, async (url) =>
      url.includes("newstories") ? response([1]) : response(null),
    );
    expect((await absent.fetchSince(null, signal())).items).toEqual([]);
  });
  it("rejeita ID divergente e falha sem retornar cursor parcial", async () => {
    const adapter = new HackerNewsAdapter({}, async (url) =>
      url.includes("newstories") ? response([1]) : response({ id: 2 }),
    );
    await expect(adapter.fetchSince(null, signal())).rejects.toThrow("ID divergente");
  });
});

describe("segurança e normalização", () => {
  it.each([
    "https://127.0.0.1/v0/newstories.json",
    "http://api.github.com/repos/a/b/releases",
    "https://api.github.com.evil.org/repos/a/b/releases",
    "https://user:secret@api.github.com/repos/a/b/releases",
    "https://hacker-news.firebaseio.com:444/v0/newstories.json",
    "https://api.github.com/latest/meta-data",
  ])("bloqueia transporte arbitrário: %s", (url) => {
    expect(() => validateTransportUrl(url)).toThrow();
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.88.99.2",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::ffff:127.0.0.1",
    "::1",
  ])("bloqueia IP reservado: %s", (address) => expect(isPublicIPv4(address)).toBe(false));
  it("aceita IP público e URLs de contrato", () => {
    expect(isPublicIPv4("1.1.1.1")).toBe(true);
    expect(
      validateTransportUrl("https://api.github.com/repos/huggingface/transformers/releases?page=2")
        .hostname,
    ).toBe("api.github.com");
  });
  it("preserva parâmetros semânticos, versão e fragmento", () => {
    expect(canonicalizeUrl("https://example.org/release?v=2&utm_source=x#changes")).toBe(
      "https://example.org/release?v=2#changes",
    );
  });
  it("não registra mensagens externas nem segredos; retry tem backoff e respeita quota", () => {
    expect(safeError(new Error("token=SEGREDO https://privado"))).toMatchObject({
      code: "INGESTION_FAILED",
    });
    expect(safeError(new IngestionError("TIMEOUT")).code).toBe("TIMEOUT");
    expect(retryDelay(2, 0, () => 0)).toBe(60000);
    expect(retryDelay(1, 120000, () => 0)).toBe(120000);
  });
});
