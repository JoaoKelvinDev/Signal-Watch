import { afterEach, describe, expect, it, vi } from "vitest";
import { readAdminBody } from "../../src/api/admin/body";
import { sameOriginMutation, sessionCookie } from "../../src/backend/admin/auth";
import { checkStatus, IngestionError } from "../../src/backend/ingestion/errors";

afterEach(() => vi.unstubAllEnvs());
function streamingRequest(stream: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request("http://localhost/api/admin", {
    method: "POST",
    body: stream,
    duplex: "half",
    signal,
  } as RequestInit & { duplex: "half" });
}
describe("revisão de segurança administrativa", () => {
  it.each([
    { "retry-after": "not-a-date" },
    { "retry-after": "9999999999999999999999999999999999999999" },
    { "x-ratelimit-reset": "invalid-number" },
  ])("bloqueia janela de quota inválida sem produzir data inválida na fila: %j", (headers) => {
    try {
      checkStatus(429, headers);
      throw new Error("Erro esperado");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect(error).toMatchObject({ code: "INVALID_RETRY_WINDOW", blocked: true });
    }
  });
  it("interrompe cliente que não encerra o corpo, mesmo após JSON válido", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"action":"logout"}'));
      },
      cancel: cancelled,
    });
    await expect(readAdminBody(streamingRequest(stream), 20)).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("não espera indefinidamente pelo cancelamento do transporte", async () => {
    const stream = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) });
    await expect(readAdminBody(streamingRequest(stream), 20)).rejects.toThrow();
  });
  it("cancelamento anterior impede processar o corpo", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readAdminBody(streamingRequest(new ReadableStream(), controller.signal)),
    ).rejects.toThrow();
  });
  it("recusa origem opaca configurada e assinatura Origin null", () => {
    vi.stubEnv("APP_ORIGIN", "file:///tmp/invalid");
    const request = new Request("https://radar.test/api/admin", {
      method: "POST",
      headers: { Origin: "null", "Content-Type": "application/json" },
    });
    expect(sameOriginMutation(request)).toBe(false);
  });
  it("HTTPS público mantém cookie Secure atrás de proxy, fora da Vercel", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("APP_ORIGIN", "https://radar.test");
    const request = new Request("http://localhost:3000/api/admin", {
      method: "POST",
      headers: { Origin: "https://radar.test", "Content-Type": "application/json" },
    });
    expect(sameOriginMutation(request)).toBe(true);
    expect(sessionCookie(request, "test")).toContain("; Secure");
  });
});
