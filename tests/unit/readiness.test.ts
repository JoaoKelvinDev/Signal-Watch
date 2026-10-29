import { expect, it, vi } from "vitest";
import { GET } from "../../src/api/health/readiness";

it("readiness retorna 503 sem expor detalhes quando falta configuração", async () => {
  vi.stubEnv("DATABASE_URL", "");
  try {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  } finally {
    vi.unstubAllEnvs();
  }
});
it("readiness limita rajadas públicas antes de abrir outra conexão", async () => {
  vi.stubEnv("DATABASE_URL", "");
  try {
    const responses = [];
    for (let request = 0; request < 61; request++) responses.push(await GET());
    const blocked = responses.find((response) => response.status === 429);
    expect(blocked).toBeDefined();
    expect(blocked?.headers.get("Cache-Control")).toBe("no-store");
    expect(blocked?.headers.get("Retry-After")).toBe("60");
  } finally {
    vi.unstubAllEnvs();
  }
});
