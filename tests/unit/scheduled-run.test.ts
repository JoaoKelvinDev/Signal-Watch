import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/backend/database/client";
import type { Claim } from "../../src/backend/worker/queue";
import { claimNext, completeJob, failJob, scheduleDue } from "../../src/backend/worker/queue";
import { makeAdapter } from "../../src/backend/ingestion/registry";
import { runOne, runScheduledBatch } from "../../src/backend/worker/run";

vi.mock("../../src/backend/worker/queue", () => ({
  claimNext: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  scheduleDue: vi.fn(),
}));
vi.mock("../../src/backend/ingestion/registry", () => ({ makeAdapter: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const db = {} as Database;
const claim = (slug: string) =>
  ({
    job: { attempts: 1 },
    source: { slug, type: "github_releases", config: {}, cursor: null },
  }) as Claim;
describe("execução limitada para serverless", () => {
  it("não reserva trabalho sem margem para fetch e commit", async () => {
    const result = await runScheduledBatch(db, new AbortController().signal, 99000);
    expect(scheduleDue).toHaveBeenCalledOnce();
    expect(claimNext).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });
  it("cancelamento anterior não cria uma reserva", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await runOne(db, controller.signal)).toBeNull();
    expect(claimNext).not.toHaveBeenCalled();
  });
  it("falha de uma fonte não impede a seguinte e não vaza mensagem externa", async () => {
    vi.mocked(claimNext)
      .mockResolvedValueOnce(claim("broken"))
      .mockResolvedValueOnce(claim("healthy"))
      .mockResolvedValue(null);
    const fetchSince = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret-token-in-error"))
      .mockResolvedValueOnce({
        items: [],
        cursor: {},
        quota: {},
        notModified: true,
        truncated: false,
      });
    vi.mocked(makeAdapter).mockReturnValue({ fetchSince } as unknown as ReturnType<
      typeof makeAdapter
    >);
    vi.mocked(completeJob).mockResolvedValue({ inserted: 0, duplicates: 0 });
    const result = await runScheduledBatch(db, new AbortController().signal);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[1].status).toBe("success");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(failJob).toHaveBeenCalledOnce();
  });
  it("limita uma chamada a oito jobs mesmo com fila cheia", async () => {
    vi.mocked(claimNext).mockResolvedValue(claim("healthy"));
    vi.mocked(makeAdapter).mockReturnValue({
      fetchSince: vi.fn().mockResolvedValue({
        items: [],
        cursor: {},
        quota: {},
        notModified: false,
        truncated: false,
      }),
    } as unknown as ReturnType<typeof makeAdapter>);
    vi.mocked(completeJob).mockResolvedValue({ inserted: 0, duplicates: 0 });
    const result = await runScheduledBatch(db, new AbortController().signal);
    expect(result.processed).toBe(8);
    expect(claimNext).toHaveBeenCalledTimes(8);
  });
});
