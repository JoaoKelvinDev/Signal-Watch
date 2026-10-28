import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { RequestOptions } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { getJson } from "../../src/backend/ingestion/http";

const url = "https://api.github.com/repos/huggingface/transformers/releases";
type FakeResponse = PassThrough & { statusCode: number; headers: Record<string, string> };

function installResponse(
  status: number,
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
  streamErrorOnDestroy = false,
) {
  mocks.request.mockImplementation(
    (_url: URL, _options: RequestOptions, callback: (response: FakeResponse) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          const response = Object.assign(new PassThrough(), { statusCode: status, headers });
          response.on("end", () => req.emit("close"));
          if (streamErrorOnDestroy) {
            const destroy = response.destroy.bind(response);
            response.destroy = () => destroy(new Error("RESPONSE_DISCARDED"));
          }
          callback(response);
          response.end(body);
        },
        destroy: (error: Error) => {
          req.emit("error", error);
          req.emit("close");
        },
      });
      return req;
    },
  );
}

beforeEach(() => {
  mocks.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("transporte com socket e DNS controlados, sem rede", () => {
  it("cancela consulta DNS pendente sem abrir socket", async () => {
    mocks.lookup.mockImplementation(() => new Promise<never>(() => {}));
    const controller = new AbortController();
    const pending = getJson(url, {}, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("aplica o prazo de 15 segundos também à resolução DNS", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([{ address: "1.1.1.1", family: 4 }]), 30000),
        ),
    );
    const pending = getJson(url, {}, new AbortController().signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
    await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("mantém um único orçamento de tempo entre DNS e conexão", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([{ address: "1.1.1.1", family: 4 }]), 10000),
        ),
    );
    mocks.request.mockImplementation(() => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {},
        destroy: (error: Error) => {
          req.emit("error", error);
          req.emit("close");
        },
      });
      return req;
    });
    const pending = getJson(url, {}, new AbortController().signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10001);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
  it("não inicia DNS quando o sinal já está cancelado", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getJson(url, {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("recusa DNS privado antes de abrir socket", async () => {
    mocks.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(getJson(url, {}, new AbortController().signal)).rejects.toMatchObject({
      code: "UNSAFE_DNS",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("fixa no socket o endereço público resolvido", async () => {
    installResponse(200, "[]");
    expect((await getJson(url, {}, new AbortController().signal)).body).toEqual([]);
    const options = mocks.request.mock.calls[0][1];
    const callback = vi.fn();
    options.lookup("api.github.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "1.1.1.1", 4);
    expect(options.family).toBe(4);
  });
  it("não segue redirecionamento para rede interna e trata erro ao encerrar o corpo", async () => {
    installResponse(
      302,
      "",
      { "content-type": "text/plain", location: "https://127.0.0.1/" },
      true,
    );
    expect((await getJson(url, {}, new AbortController().signal)).status).toBe(302);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rejeita resposta maior que 2 MiB", async () => {
    installResponse(200, "x".repeat(2 * 1024 * 1024 + 1));
    await expect(getJson(url, {}, new AbortController().signal)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });
  });
  it("rejeita conteúdo que não seja JSON", async () => {
    installResponse(200, "<script>executar()</script>", { "content-type": "text/html" });
    await expect(getJson(url, {}, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
  });
  it("encerra socket que excede prazo de 15 segundos", async () => {
    vi.useFakeTimers();
    mocks.request.mockImplementation(() => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {},
        destroy: (error: Error) => {
          req.emit("error", error);
          req.emit("close");
        },
      });
      return req;
    });
    const pending = getJson(url, {}, new AbortController().signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
  });
});
