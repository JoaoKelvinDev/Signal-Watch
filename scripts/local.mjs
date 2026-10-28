// Início local com ciclo de vida único. Não publica nem altera serviços instalados.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
if (!env.DATABASE_URL) {
  console.error("Configure DATABASE_URL no .env antes de iniciar. Consulte o README.");
  process.exit(1);
}
const data = resolve(root, ".local/postgres");
const pgBin = env.RADAR_POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18w/bin";
const pgCtl = resolve(pgBin, process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
let url;
try {
  url = new URL(env.DATABASE_URL);
} catch {
  console.error("DATABASE_URL inválida. Corrija a configuração no .env.");
  process.exit(1);
}
const port = Number(env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("PORT deve ser uma porta entre 1024 e 65535.");
  process.exit(1);
}
const address = `http://127.0.0.1:${port}`;
const isWorkspaceDatabase =
  url.hostname === "127.0.0.1" &&
  url.port === "55439" &&
  url.pathname === "/radar_dev" &&
  existsSync(resolve(data, "PG_VERSION"));
let ownsDatabase = false;
let stopping = false;
const children = [];

function pg(args) {
  return spawnSync(pgCtl, ["-D", data, ...args], {
    cwd: root,
    windowsHide: true,
    encoding: "utf8",
    timeout: 30000,
  });
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children
      .filter((child) => child.exitCode === null)
      .map(
        (child) =>
          new Promise((done) => {
            const timeout = setTimeout(done, 5000);
            child.once("exit", () => {
              clearTimeout(timeout);
              done();
            });
            child.kill("SIGTERM");
          }),
      ),
  );
  if (ownsDatabase) pg(["-m", "fast", "-w", "stop"]);
  process.exitCode = code;
}

if (isWorkspaceDatabase) {
  if (!existsSync(pgCtl)) {
    console.error("Defina RADAR_POSTGRES_BIN com a pasta dos binários PostgreSQL.");
    process.exit(1);
  }
  if (pg(["status"]).status !== 0) {
    const result = pg([
      "-l",
      resolve(root, ".local/postgres.log"),
      "-o",
      "-h 127.0.0.1 -p 55439",
      "-w",
      "start",
    ]);
    if (result.status !== 0) {
      console.error("Não foi possível iniciar o banco local. Consulte .local/postgres.log.");
      process.exit(1);
    }
    ownsDatabase = true;
  }
}

for (const script of ["scripts/database/migrate.ts", "scripts/editorial/process.ts"]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    await shutdown(1);
    process.exit(1);
  }
}

let reuseServer = false;
try {
  const response = await fetch(`${address}/api/feed`, {
    signal: AbortSignal.timeout(3000),
  });
  if (response.ok) {
    const data = await response.json();
    reuseServer =
      Array.isArray(data.items) &&
      Array.isArray(data.sources) &&
      typeof data.generatedAt === "string";
  }
} catch {
  /* Sem feed pronto: iniciar servidor abaixo. */
}

const commands = [["--import", "tsx", "src/backend/worker/main.ts"]];
if (!reuseServer) {
  if (!existsSync(resolve(root, ".next/BUILD_ID"))) {
    console.error("Execute npm.cmd run build antes de iniciar o acesso local.");
    await shutdown(1);
    process.exit(1);
  }
  commands.unshift([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
} else console.log("Reutilizando o site local. A coleta será executada por este comando.");
for (const args of commands) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", () => {
    console.error("Falha ao iniciar processo local.");
    shutdown(1);
  });
  child.on("exit", (code) => {
    if (!stopping) shutdown(code ?? 1);
  });
}
process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());
console.log(`Radar em ${address} — Ctrl+C encerra os processos iniciados por este comando.`);
