import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const target = new URL(process.env.RADAR_BASE_URL ?? "http://127.0.0.1:3001");
assert.ok(
  target.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(target.hostname) &&
    !target.username &&
    !target.password,
  "Ciclo HTTP de teste somente local.",
);
assert.ok(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32);
// Teste ONLINE separado: dispara coleta real, com autenticação, no banco configurado pelo operador.
const response = await fetch(`${target.origin}/api/cron/ingest`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  signal: AbortSignal.timeout(250000),
});
assert.equal(response.status, 200);
const result = (await response.json()) as {
  processed: number;
  failed: number;
  results: { source: string; status: string; inserted?: number; duplicates?: number }[];
};
assert.equal(result.failed, 0);
assert.ok(
  result.results.some(
    (run) => run.source === "huggingface-transformers" && run.status === "success",
  ),
  "Torne a fonte GitHub devida antes do teste.",
);
assert.ok(
  result.results.some((run) => run.source === "hacker-news" && run.status === "success"),
  "Torne a fonte HN devida antes do teste.",
);
const evidence = {
  checkedAt: new Date().toISOString(),
  environment: "local-production-build",
  trigger: "authenticated-http-post",
  ...result,
};
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/scheduled-http.json",
  JSON.stringify(evidence, null, 2) + "\n",
  "utf8",
);
console.log(JSON.stringify(evidence));
