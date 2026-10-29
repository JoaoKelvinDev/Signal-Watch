import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseConfig } from "../../src/backend/database/config";
import {
  adminCookie,
  createAdminSession,
  sameOriginMutation,
  sessionCookie,
  validAdminSession,
  validPassword,
} from "../../src/backend/admin/auth";
import { validCronAuthorization, POST as cron } from "../../src/api/cron/handler";
import { POST as admin, GET as dashboard } from "../../src/api/admin/handler";
import { parseLibrary } from "../../src/frontend/library-store";
import { actionSchema } from "../../src/backend/admin/service";
import { parseFeedParameters, encodeCursor, decodeCursor } from "../../src/backend/feed/parameters";

afterEach(() => vi.unstubAllEnvs());
describe("configuração em nuvem", () => {
  it("mantém verificação TLS e remove parâmetros que sobrescrevem a CA", () => {
    const config = databaseConfig(
      "postgresql://postgres:example@aws-0-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require&sslrootcert=private.pem",
      {},
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).not.toContain("private.pem");
    expect(config.max).toBe(1);
    expect(config.options).toBeUndefined();
  });
  it("recusa desabilitar TLS em Supabase e na Vercel", () => {
    expect(() =>
      databaseConfig("postgresql://postgres@db.example.supabase.co/postgres?sslmode=disable", {}),
    ).toThrow();
    expect(() =>
      databaseConfig("postgresql://postgres@example.com/postgres?ssl=false", { VERCEL: "1" }),
    ).toThrow();
  });
  it("não inclui uma URL inválida na mensagem de erro", () => {
    expect(() => databaseConfig("sensitive-invalid-password", {})).toThrow(
      "Configuração do banco inválida.",
    );
  });
});
describe("administração e coleta", () => {
  it("nega acesso sem configuração ou sessão", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await dashboard(new Request("https://radar.test/api/admin"))).status).toBe(503);
    vi.stubEnv("ADMIN_PASSWORD", "a".repeat(48));
    expect((await dashboard(new Request("https://radar.test/api/admin"))).status).toBe(401);
    expect(validPassword("wrong")).toBe(false);
  });
  it("sessões expiram e adulteração ou rotação de senha invalida a assinatura", () => {
    vi.stubEnv("ADMIN_PASSWORD", "a".repeat(48));
    const now = 1793289600000;
    const session = createAdminSession(now),
      cookie = `${adminCookie}=${session}`;
    expect(validAdminSession(cookie, now)).toBe(true);
    expect(validAdminSession(cookie, now + 43200001)).toBe(false);
    expect(validAdminSession(`${cookie}x`, now)).toBe(false);
    vi.stubEnv("ADMIN_PASSWORD", "b".repeat(48));
    expect(validAdminSession(cookie, now)).toBe(false);
  });
  it("exige JSON e origem exata em mutações", async () => {
    const request = new Request("https://radar.test/api/admin", {
      method: "POST",
      headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
      body: '{"action":"logout"}',
    });
    expect(sameOriginMutation(request)).toBe(false);
    expect((await admin(request)).status).toBe(403);
    const cookie = sessionCookie(new Request("https://radar.test"), "example");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
  });
  it("limita corpo administrativo antes de acessar banco", async () => {
    expect(
      actionSchema.safeParse({
        action: "create",
        slug: "example",
        name: "Example",
        owner: "example",
        repo: "project",
        ownershipUrl: "invalid-url",
        permissions: "Somente metadados revisados",
        intervalSeconds: 900,
      }).success,
    ).toBe(false);
    vi.stubEnv("ADMIN_PASSWORD", "a".repeat(48));
    const request = new Request("https://radar.test/api/admin", {
      method: "POST",
      headers: { Origin: "https://radar.test", "Content-Type": "application/json" },
      body: "x".repeat(4097),
    });
    expect((await admin(request)).status).toBe(400);
  });
  it("valida a origem pública atrás de proxy e mantém cookie Secure na Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "signal-watch-ten.vercel.app");
    const request = new Request("http://localhost:3000/api/admin", {
      method: "POST",
      headers: {
        Origin: "https://signal-watch-ten.vercel.app",
        "Content-Type": "application/json",
      },
    });
    expect(sameOriginMutation(request)).toBe(true);
    expect(sessionCookie(request, "test")).toContain("Secure");
    const attacker = new Request("http://localhost:3000/api/admin", {
      method: "POST",
      headers: {
        Origin: "https://evil.test",
        "Content-Type": "application/json",
        Host: "evil.test",
      },
    });
    expect(sameOriginMutation(attacker)).toBe(false);
  });
  it("cron exige segredo forte e bearer exato; previews ficam bloqueados", async () => {
    vi.stubEnv("CRON_SECRET", "a".repeat(48));
    expect(validCronAuthorization("Bearer " + "a".repeat(48))).toBe(true);
    expect(validCronAuthorization("Bearer wrong")).toBe(false);
    expect(validCronAuthorization("Bearer short", "short")).toBe(false);
    expect(
      (await cron(new Request("https://radar.test/api/cron/ingest", { method: "POST" }))).status,
    ).toBe(401);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(
      (
        await cron(
          new Request("https://radar.test/api/cron/ingest", {
            method: "POST",
            headers: { Authorization: "Bearer " + "a".repeat(48) },
          }),
        )
      ).status,
    ).toBe(409);
  });
});
describe("preferências e filtros", () => {
  it("ignora armazenamento inválido e não aceita campos extras ou IDs executáveis", () => {
    expect(parseLibrary("not json").items).toEqual([]);
    expect(
      parseLibrary(
        JSON.stringify({
          version: 1,
          items: [{ id: "javascript:alert(1)", title: "x", read: true, saved: true }],
          theme: "dark",
          topic: "",
          company: "",
        }),
      ).items,
    ).toEqual([]);
  });
  it("vincula todos os filtros ao cursor e rejeita períodos invertidos", () => {
    const params = parseFeedParameters(
      new URLSearchParams(
        "topic=models&company=OpenAI&type=release&language=en&status=official_announcement&origin=official&sort=relevance",
      ),
    );
    const cursor = encodeCursor(
      "2026-10-29T00:00:00.000000Z",
      "00000000-0000-4000-8000-000000000001",
      params,
      6,
    );
    expect(decodeCursor(cursor, params).rank).toBe(6);
    expect(() => decodeCursor(cursor, { ...params, company: "Anthropic" })).toThrow();
    expect(() =>
      parseFeedParameters(new URLSearchParams("from=2026-10-29T00:00:00Z&to=2026-10-28T00:00:00Z")),
    ).toThrow();
  });
});
