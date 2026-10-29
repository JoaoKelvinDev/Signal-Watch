"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { EventDetail } from "../../shared/contracts/event";
import { editorialStatusLabels, eventTypeLabels } from "../../shared/catalog";
import { ItemActions } from "./library";
import { UtilityPage } from "./utility-page";

function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Não informada";
}
export function EventDetailView({ id }: { id: string }) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/events/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Evento não encontrado."
              : "Não foi possível carregar o evento.",
          );
        return response.json() as Promise<EventDetail>;
      })
      .then(setDetail)
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Não foi possível carregar o evento. Volte ao feed e tente novamente.");
      });
    return () => controller.abort();
  }, [id]);
  return (
    <UtilityPage>
      <Link href="/">← Voltar ao Radar</Link>
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <p role="status">Carregando evento…</p>}
      {detail && (
        <>
          <p>
            {editorialStatusLabels[detail.item.editorialStatus] ?? detail.item.editorialStatus} ·{" "}
            {eventTypeLabels[detail.item.type] ?? detail.item.type}
          </p>
          <h1>{detail.item.title}</h1>
          <ItemActions item={detail.item} />
          <p>
            {detail.item.summary ??
              "Informação insuficiente para um resumo factual. Foram coletados metadados; consulte as publicações originais."}
          </p>
          <p>{detail.rationale}</p>
          {detail.impact && <p>{detail.impact}</p>}
          <dl>
            <dt>Publicação</dt>
            <dd>{date(detail.item.publishedAt)}</dd>
            <dt>Descoberta pelo Radar</dt>
            <dd>{date(detail.item.discoveredAt)}</dd>
            <dt>Última alteração</dt>
            <dd>{date(detail.item.lastChangedAt)}</dd>
          </dl>
          <p>
            Horários de Brasília. Na comunidade, publicação representa a submissão no HN; a data do
            artigo externo pode ser desconhecida.
          </p>
          <h2>Evidências e cobertura relacionada</h2>
          {detail.item.sources.map((source, index) => (
            <section key={`${source.slug}-${index}`}>
              <h3>{source.name}</h3>
              <p>{source.title}</p>
              <p>
                {source.editorialLevel === "official" ? "Origem oficial" : "Origem comunitária"} ·{" "}
                {date(source.publishedAt)}
              </p>
              <a href={source.originalUrl} target="_blank" rel="noopener noreferrer">
                Publicação original ↗
              </a>
              {source.discussionUrl && (
                <p>
                  <a href={source.discussionUrl} target="_blank" rel="noopener noreferrer">
                    Discussão no HN ↗
                  </a>
                </p>
              )}
            </section>
          ))}
          <h2>Histórico de alterações</h2>
          <p>Exibidas as últimas 100 alterações factuais registradas.</p>
          {!detail.history.length && <p>Nenhuma alteração registrada após a primeira coleta.</p>}
          {detail.history.map((version) => (
            <section key={version.id}>
              <time dateTime={version.at}>{date(version.at)}</time>
              <p>{version.rationale}</p>
              {version.previousTitle && <p>Título anterior: {version.previousTitle}</p>}
            </section>
          ))}
        </>
      )}
    </UtilityPage>
  );
}
