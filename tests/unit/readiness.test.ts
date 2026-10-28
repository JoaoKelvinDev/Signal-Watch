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
