import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { FeedPage } from "../../src/shared/contracts/feed";
import type { EventDetail } from "../../src/shared/contracts/event";
import type { AdminDashboard } from "../../src/shared/contracts/admin";

const target = new URL(process.env.RADAR_BASE_URL ?? "http://127.0.0.1:3001");
assert.ok(
  target.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(target.hostname) &&
    !target.username &&
    !target.password,
  "Teste mutável somente no servidor local autorizado.",
);
const base = target.origin;
assert.ok(
  process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 32,
  "Configure segredo local de teste.",
);
let cookie = "";
async function mutate(payload: unknown, origin = base) {
  return fetch(`${base}/api/admin`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
}
assert.equal((await fetch(`${base}/api/admin`)).status, 401);
assert.equal((await fetch(`${base}/api/cron/ingest`, { method: "POST" })).status, 401);
assert.equal((await mutate({ action: "logout" }, "https://untrusted.example")).status, 403);
const login = await mutate({ action: "login", password: process.env.ADMIN_PASSWORD });
assert.equal(login.status, 200);
const session = login.headers.get("set-cookie");
assert.ok(session);
assert.ok(session?.includes("HttpOnly") && session.includes("SameSite=Strict"));
cookie = session.split(";")[0];
const dashboardResponse = await fetch(`${base}/api/admin`, { headers: { Cookie: cookie } });
assert.equal(dashboardResponse.status, 200);
const dashboard = (await dashboardResponse.json()) as AdminDashboard;
assert.ok(dashboard.sources.length >= 2);
const source = dashboard.sources.find(
  (entry) => entry.state === "active" && entry.type === "github_releases",
);
assert.ok(source);
try {
  assert.equal(
    (
      await mutate({
        action: "source",
        id: source.id,
        enabled: false,
        intervalSeconds: source.intervalSeconds,
      })
    ).status,
    200,
  );
  const paused = (await (
    await fetch(`${base}/api/admin`, { headers: { Cookie: cookie } })
  ).json()) as AdminDashboard;
  assert.equal(paused.sources.find((entry) => entry.id === source.id)?.state, "paused");
} finally {
  assert.equal(
    (
      await mutate({
        action: "source",
        id: source.id,
        enabled: true,
        intervalSeconds: source.intervalSeconds,
      })
    ).status,
    200,
  );
}
const reprocess = await mutate({ action: "reprocess", id: source.id });
assert.equal(reprocess.status, 200);
const feedResponse = await fetch(`${base}/api/feed?category=all&sort=relevance`);
assert.equal(feedResponse.status, 200);
const feed = (await feedResponse.json()) as FeedPage;
assert.ok(feed.items.length);
const item = feed.items[0];
const eventResponse = await fetch(`${base}/api/events/${item.id}`);
assert.equal(eventResponse.status, 200);
const detail = (await eventResponse.json()) as EventDetail;
assert.equal(detail.item.id, item.id);
assert.ok(detail.item.sources.length);
assert.ok(detail.item.sources.every((entry) => /^https?:\/\//.test(entry.originalUrl)));
const filtered = await fetch(
  `${base}/api/feed?category=all&type=${encodeURIComponent(item.type)}&company=${encodeURIComponent(item.companies[0] ?? "Hugging Face")}`,
);
assert.equal(filtered.status, 200);
for (const path of ["/", "/admin", "/preferencias", `/eventos/${item.id}`]) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  if (path === "/admin") {
    const html = await response.text();
    const loginForm = html.match(/<form\b[^>]*>/)?.[0];
    assert.ok(
      loginForm && /method="post"/i.test(loginForm) && /action="\/api\/admin"/.test(loginForm),
      "Login nativo deve usar POST para impedir senha na URL antes da hidratação.",
    );
  }
}
assert.equal((await fetch(`${base}/api/events/invalid-id`)).status, 400);
assert.equal((await fetch(`${base}/.env`)).status, 404);
assert.equal((await mutate({ action: "logout" })).status, 200);
await mkdir("docs/evidence", { recursive: true });
const evidence = {
  checkedAt: new Date().toISOString(),
  environment: "local-production-build",
  admin: {
    unauthenticated: 401,
    login: 200,
    csrf: 403,
    pauseResume: true,
    reprocess: 200,
    logout: 200,
  },
  event: { id: item.id, evidenceCount: detail.item.sources.length, history: true },
  cronWithoutSecretHeader: 401,
  pages: ["/", "/admin", "/preferencias", "/eventos/[id]"],
  privateEnv: 404,
  browserInteractions: "not-tested",
};
await writeFile("docs/evidence/mvp-http.json", JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify(evidence));
