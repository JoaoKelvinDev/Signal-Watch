import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const versionable = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : Promise.resolve([path.join(directory, entry.name)]),
      ),
    )
  ).flat();
}
const client = await files(".next/static");
const values = [
  process.env.ADMIN_PASSWORD,
  process.env.CRON_SECRET,
  process.env.GITHUB_TOKEN,
].filter((value): value is string => Boolean(value && value.length >= 16));
const password = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).password : "";
if (password.length >= 16) {
  values.push(password);
  values.push(decodeURIComponent(password));
}
const patterns =
  /sb_secret_[A-Za-z0-9_-]{20,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
function sensitiveContent(content: string) {
  if (patterns.test(content) || values.some((value) => content.includes(value))) return true;
  return [...content.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].some(
    ([token]) => {
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
        ) as { role?: unknown };
        return payload.role === "service_role";
      } catch {
        return false;
      }
    },
  );
}
const findings: string[] = [];
const inventory: { file: string; bytes: number; sha256: string }[] = [];
for (const file of new Set([...versionable, ...client])) {
  const bytes = await readFile(file);
  if (sensitiveContent(bytes.toString("utf8"))) findings.push(file);
  if (
    versionable.includes(file) &&
    ![
      "docs/evidence/security-file-inventory.json",
      "docs/evidence/cloud-secrets-check.json",
    ].includes(file)
  )
    inventory.push({
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
}
const inspectHistory = process.argv.includes("--history");
const historyFindings: { object: string; path: string }[] = [];
let historyBlobs = 0;
if (inspectHistory) {
  const objects = execFileSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const types = execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    input: objects.map((line) => line.split(" ")[0]).join("\n") + "\n",
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/);
  for (const [index, metadata] of types.entries()) {
    const [oid, type] = metadata.split(" ");
    if (type !== "blob") continue;
    historyBlobs++;
    const content = execFileSync("git", ["cat-file", "blob", oid], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (sensitiveContent(content))
      historyFindings.push({ object: oid, path: objects[index].slice(oid.length + 1) });
  }
  await writeFile(
    "docs/evidence/security-file-inventory.json",
    JSON.stringify(
      inventory.sort((a, b) => a.file.localeCompare(b.file)),
      null,
      2,
    ) + "\n",
    "utf8",
  );
}
const ignored = [
  ".env",
  ".local/validation.env",
  ".local/supabase-transfer.sql",
  ".vercel/project.json",
  ".pgpass",
  ".npmrc",
  "backups/database.sql",
];
const ignoredResult = execFileSync("git", ["check-ignore", "--", ...ignored], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/);
assert.deepEqual(ignoredResult, ignored);
const evidence = {
  checkedAt: new Date().toISOString(),
  versionableFiles: new Set(versionable).size,
  clientFiles: client.length,
  ignored,
  findings,
  history: { checked: inspectHistory, blobs: historyBlobs, findings: historyFindings },
  scope:
    "Arquivos versionáveis, bundle estático e histórico Git quando solicitado; padrões de chaves e valores privados locais conhecidos. Credenciais privadas cadastradas somente na Vercel não foram lidas. Não é garantia sobre todo segredo possível.",
};
await writeFile(
  "docs/evidence/cloud-secrets-check.json",
  JSON.stringify(evidence, null, 2) + "\n",
  "utf8",
);
console.log(JSON.stringify(evidence));
assert.equal(findings.length, 0, "Revisar os caminhos indicados, sem imprimir credenciais.");
assert.equal(
  historyFindings.length,
  0,
  "Revisar objetos históricos indicados, sem imprimir credenciais.",
);
