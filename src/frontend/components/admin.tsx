"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { AdminAction, AdminDashboard } from "../../shared/contracts/admin";
import { UtilityPage } from "./utility-page";

export function AdminView() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [message, setMessage] = useState("Carregando administração…");
  const [busy, setBusy] = useState(false);
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/admin", { cache: "no-store", signal });
    if (response.ok) {
      setDashboard((await response.json()) as AdminDashboard);
      setMessage("");
    } else {
      setDashboard(null);
      setMessage(
        response.status === 401
          ? "Entre para administrar as fontes."
          : "Administração indisponível. Confira ADMIN_PASSWORD e a conexão do banco no servidor.",
      );
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.ok) {
          setDashboard((await response.json()) as AdminDashboard);
          setMessage("");
        } else
          setMessage(
            response.status === 401
              ? "Entre para administrar as fontes."
              : "Administração indisponível. Confira a configuração do servidor.",
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Falha de conexão.");
      });
    return () => controller.abort();
  }, []);
  async function action(payload: AdminAction) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        processed?: number;
        nextCursor?: string | null;
      };
      if (!response.ok) {
        setMessage(result.error ?? "Operação não concluída.");
        return;
      }
      await load();
      if (payload.action === "reprocess") {
        const sourceId = payload.id;
        setCursors((current) => ({ ...current, [sourceId]: result.nextCursor ?? null }));
      }
      if (result.processed !== undefined)
        setMessage(
          `${result.processed} itens reprocessados. ${result.nextCursor ? "Clique novamente para continuar o próximo lote." : "Último lote concluído."} A operação é idempotente.`,
        );
    } catch {
      setMessage("Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    form.reset();
    void action({ action: "login", password });
  }
  return (
    <UtilityPage>
      <Link href="/">← Voltar ao Radar</Link>
      <h1>Administração</h1>
      <p role="status">{message}</p>
      {!dashboard ? (
        <form method="post" action="/api/admin" onSubmit={login}>
          <label>
            Senha administrativa
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          <button disabled={busy}>Entrar</button>
        </form>
      ) : (
        <>
          <button disabled={busy} onClick={() => void action({ action: "logout" })}>
            Sair
          </button>
          <button
            disabled={busy}
            onClick={() => void load().catch(() => setMessage("Falha de conexão."))}
          >
            Atualizar saúde
          </button>
          <h2>Fila</h2>
          {dashboard.queue.map((entry) => (
            <p key={entry.state}>
              {entry.state}: {entry.count}
            </p>
          ))}
          <h2>Fontes e quotas</h2>
          <details>
            <summary>Cadastrar fonte GitHub Releases</summary>
            <p>
              Cadastre apenas repositório associado ao emissor. O cadastro começa não verificado;
              revise propriedade, termos e permissões antes de ativar.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  data = new FormData(form);
                void action({
                  action: "create",
                  slug: String(data.get("slug")),
                  name: String(data.get("name")),
                  owner: String(data.get("owner")),
                  repo: String(data.get("repo")),
                  ownershipUrl: String(data.get("ownershipUrl")),
                  permissions: String(data.get("permissions")),
                  intervalSeconds: Number(data.get("interval")),
                });
              }}
            >
              <label>
                Identificador
                <input
                  name="slug"
                  required
                  maxLength={80}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="empresa-produto"
                />
              </label>
              <label>
                Nome
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Organização GitHub
                <input name="owner" required maxLength={100} />
              </label>
              <label>
                Repositório
                <input name="repo" required maxLength={100} />
              </label>
              <label>
                Evidência de associação oficial (HTTPS)
                <input name="ownershipUrl" type="url" required maxLength={500} />
              </label>
              <label>
                Permissões e termos revisados
                <input name="permissions" required minLength={20} maxLength={1000} />
              </label>
              <label>
                Intervalo em segundos
                <input
                  name="interval"
                  type="number"
                  required
                  min={300}
                  max={86400}
                  defaultValue={900}
                />
              </label>
              <button disabled={busy}>Cadastrar como não verificada</button>
            </form>
          </details>
          <p>
            Fontes novas e fontes bloqueadas exigem cadastro revisado e teste de contrato no
            servidor. Pausar impede novas coletas; uma execução já reservada pode terminar.
          </p>
          {dashboard.sources.map((source) => (
            <section key={source.id}>
              <h3>{source.name}</h3>
              <p>
                {source.type} · {source.state}
              </p>
              <p>
                <a href={source.ownershipUrl} target="_blank" rel="noopener noreferrer">
                  Evidência de propriedade ↗
                </a>{" "}
                ·{" "}
                <a href={source.documentationUrl} target="_blank" rel="noopener noreferrer">
                  Documentação ↗
                </a>
              </p>
              <p>{source.permissions}</p>
              <form
                key={`${source.id}-${source.state}-${source.intervalSeconds}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void action({ action: "verify", id: source.id, reviewed: true });
                }}
              >
                <label>
                  <input type="checkbox" required /> Revisei a associação ao emissor, documentação,
                  termos, quotas e permissão para armazenar/exibir estes metadados.
                </label>
                <button disabled={busy}>Testar conexão e ativar</button>
              </form>
              <p>
                Último sucesso:{" "}
                {source.lastSuccessAt
                  ? new Date(source.lastSuccessAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })
                  : "Nenhum"}
              </p>
              <p>Último diagnóstico: {source.lastError ?? "Sem erro registrado"}</p>
              <pre>
                {JSON.stringify(
                  source.quota ?? { observacao: "Quota não informada pelo provedor" },
                  null,
                  2,
                )}
              </pre>
              <form
                key={`settings-${source.id}-${source.state}-${source.intervalSeconds}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action({
                    action: "source",
                    id: source.id,
                    enabled: data.get("enabled") === "on",
                    intervalSeconds: Number(data.get("interval")),
                  });
                }}
              >
                <label>
                  Intervalo em segundos
                  <input
                    name="interval"
                    type="number"
                    min={300}
                    max={86400}
                    required
                    defaultValue={source.intervalSeconds}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={source.state === "active"}
                  />{" "}
                  Coleta ativa
                </label>
                <button disabled={busy}>Aplicar</button>
              </form>
              <button
                disabled={busy}
                onClick={() =>
                  void action({
                    action: "reprocess",
                    id: source.id,
                    after: cursors[source.id] ?? undefined,
                  })
                }
              >
                Reprocessar metadados (até 100)
              </button>
            </section>
          ))}
          <h2>Últimas 30 execuções</h2>
          {dashboard.runs.map((run, index) => (
            <section key={`${run.sourceId}-${run.startedAt}-${index}`}>
              <p>
                {dashboard.sources.find((source) => source.id === run.sourceId)?.name} ·{" "}
                {run.status}
              </p>
              <p>
                {new Date(run.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}{" "}
                · recebidos {run.received}, novos {run.inserted}, duplicados {run.duplicates}
              </p>
              {run.error && <p>{run.error}</p>}
            </section>
          ))}
        </>
      )}
    </UtilityPage>
  );
}
