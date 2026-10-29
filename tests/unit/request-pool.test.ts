import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../../src/backend/database/client", () => ({ openDatabase: mock.open }));
beforeEach(() => {
  vi.resetModules();
  mock.open.mockReset();
});
it("requisições compartilham um único pool em vez de multiplicar conexões", async () => {
  const database = { db: {}, close: vi.fn() };
  mock.open.mockReturnValue(database);
  const { getRequestDatabase } = await import("../../src/backend/database/request-client");
  const handles = await Promise.all(Array.from({ length: 100 }, async () => getRequestDatabase()));
  expect(mock.open).toHaveBeenCalledOnce();
  expect(handles.every((handle) => handle === database.db)).toBe(true);
  expect(database.close).not.toHaveBeenCalled();
});
it("configuração inválida não deixa um cache parcialmente inicializado", async () => {
  const database = { db: {} };
  mock.open
    .mockImplementationOnce(() => {
      throw new Error("invalid configuration");
    })
    .mockReturnValue(database);
  const { getRequestDatabase } = await import("../../src/backend/database/request-client");
  expect(() => getRequestDatabase()).toThrow();
  expect(getRequestDatabase()).toBe(database.db);
});
