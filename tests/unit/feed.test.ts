import { describe, expect, it, vi } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  InvalidFeedParameters,
  parseFeedParameters,
} from "../../src/backend/feed/parameters";
import { safeExternalUrl } from "../../src/backend/feed/links";
import { createFeedLimiter } from "../../src/api/feed/rate-limit";
import { GET } from "../../src/api/feed/handler";

describe("contrato do feed", () => {
  it("prioriza IA e fontes oficiais por padrão", () => {
    expect(parseFeedParameters(new URLSearchParams())).toEqual({
      tab: "official",
      category: "ai",
      q: "",
      source: "",
      pageSize: 12,
    });
  });
  it.each([
    "pageSize=0",
    "pageSize=31",
    "pageSize=1.5",
    "pageSize=abc",
    "tab=all",
    "category=invalid",
    "source=../../secret",
    "q=a&q=b",
    "unknown=1",
    `q=${"a".repeat(121)}`,
    "cursor=not-a-cursor",
  ])("rejeita parâmetros inválidos: %s", (query) => {
    expect(() => parseFeedParameters(new URLSearchParams(query))).toThrow(InvalidFeedParameters);
  });
  it("cursor preserva microssegundos e vínculo com filtros", () => {
    const parameters = parseFeedParameters(
      new URLSearchParams("tab=community&category=all&q=transformers&pageSize=2"),
    );
    const at = "2026-10-28T12:30:00.123456Z";
    const id = "00000000-0000-4000-8000-000000000001";
    const encoded = encodeCursor(at, id, parameters);
    expect(decodeCursor(encoded, parameters)).toMatchObject({ at, id });
    expect(() => decodeCursor(encoded, { ...parameters, source: "hacker-news" })).toThrow(
      InvalidFeedParameters,
    );
    expect(() => decodeCursor(encoded, { ...parameters, pageSize: 3 })).toThrow(
      InvalidFeedParameters,
    );
  });
  it("rejeita cursor com data inválida ou SQL em ID", () => {
    const parameters = parseFeedParameters(new URLSearchParams());
    expect(() => encodeCursor("2026-99-99T12:00:00.000000Z", "x' OR true--", parameters)).toThrow();
  });
  it("bloqueia links executáveis e URLs com credenciais", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,example")).toBeNull();
    expect(safeExternalUrl("https://user:secret@example.org/private")).toBeNull();
    expect(safeExternalUrl("https://example.org/release?v=2#details")).toBe(
      "https://example.org/release?v=2#details",
    );
  });
  it("limita rajadas e volta a aceitar depois da janela", () => {
    const allow = createFeedLimiter(2, 1000);
    expect(allow(1000)).toBe(true);
    expect(allow(1100)).toBe(true);
    expect(allow(1200)).toBe(false);
    expect(allow(2000)).toBe(true);
  });
  it("API rejeita consulta inválida antes de acessar banco", async () => {
    const response = await GET(new Request("http://localhost/api/feed?pageSize=500"));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("API não expõe configuração ausente ou erro interno", async () => {
    vi.stubEnv("DATABASE_URL", "");
    try {
      const response = await GET(new Request("http://localhost/api/feed"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "As notícias estão temporariamente indisponíveis. Tente novamente.",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
