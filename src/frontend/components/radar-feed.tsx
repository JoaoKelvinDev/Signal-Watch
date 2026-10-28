"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  FeedEvidence,
  FeedItem,
  FeedPage,
  FeedSourceStatus,
} from "../../shared/contracts/feed";
import { Icon } from "./icons";

type Filters = {
  tab: "official" | "community";
  category: "ai" | "all" | "technology";
  q: string;
  source: string;
};
const defaults: Filters = { tab: "official", category: "ai", q: "", source: "" };

function dateTime(value: string | null, short = false) {
  if (!value) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    ...(short ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function safeLink(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function PublicationLink({ evidence }: { evidence: FeedEvidence }) {
  const original = safeLink(evidence.originalUrl);
  const discussion = safeLink(evidence.discussionUrl);
  return (
    <div className="publication-links">
      {original && (
        <a href={original} target="_blank" rel="noopener noreferrer">
          Ver publicação original <Icon name="arrow" size={17} />
          <span className="sr-only"> (nova aba)</span>
        </a>
      )}
      {discussion && discussion !== original && (
        <a className="discussion-link" href={discussion} target="_blank" rel="noopener noreferrer">
          Discussão no HN <span className="sr-only">(nova aba)</span>
          <Icon name="arrow" size={15} />
        </a>
      )}
    </div>
  );
}

function NewsCard({ item, index }: { item: FeedItem; index: number }) {
  const official = item.editorialStatus === "official_announcement";
  const primary =
    item.sources.find(
      (source) => source.editorialLevel === (official ? "official" : "community"),
    ) ?? item.sources[0];
  const status = official
    ? "Anúncio oficial"
    : item.editorialStatus === "community_report"
      ? "Relato comunitário"
      : "Não verificado";
  const isHn = primary?.type === "hacker_news";
  return (
    <article className="news-card" aria-labelledby={`news-${item.id}`}>
      <div className="card-number" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="card-content">
        <div className="card-eyebrow">
          <span className={official ? "status-badge official" : "status-badge community"}>
            <span className="status-dot" />
            {status}
          </span>
          <span>{item.type === "release" ? "Lançamento" : "Discussão"}</span>
          <span className="eyebrow-separator">/</span>
          <span>{item.category === "ai" ? "Inteligência artificial" : "Tecnologia"}</span>
        </div>
        <h2 id={`news-${item.id}`}>{item.title}</h2>
        {item.companies.length > 0 && (
          <p className="company-line">
            {item.companies.join(" · ")}
            {item.version && <span className="version-tag">{item.version}</span>}
          </p>
        )}
        {item.summary ? (
          <p className="card-summary">{item.summary}</p>
        ) : (
          <p className="metadata-note">
            {isHn
              ? "Título original enviado pela comunidade. O conteúdo do link externo não foi verificado."
              : "Metadados do lançamento. Consulte a fonte para detalhes e condições de disponibilidade."}
          </p>
        )}
        <div className="card-footer">
          <div className="source-byline">
            <span className={isHn ? "source-monogram hn" : "source-monogram"}>
              {isHn ? "Y" : "HF"}
            </span>
            <span>
              {primary?.name ?? "Origem não informada"}
              <span className="source-date">
                {primary?.publishedAt ? (
                  <>
                    {isHn ? "Enviado ao HN" : "Publicado"}{" "}
                    <time dateTime={primary.publishedAt}>
                      {dateTime(primary.publishedAt, true)}
                    </time>
                  </>
                ) : (
                  "Publicação não informada"
                )}
              </span>
            </span>
          </div>
          {primary && <PublicationLink evidence={primary} />}
        </div>
        <details className="evidence-details">
          <summary>
            Procedência e datas{" "}
            <span>
              {item.sources.length} {item.sources.length === 1 ? "fonte" : "fontes"}
            </span>
          </summary>
          <dl className="event-dates">
            <div>
              <dt>Descoberto pelo Radar</dt>
              <dd>
                <time dateTime={item.discoveredAt}>{dateTime(item.discoveredAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Última alteração do registro</dt>
              <dd>
                <time dateTime={item.lastChangedAt}>{dateTime(item.lastChangedAt)}</time>
              </dd>
            </div>
          </dl>
          {item.sources.map((source, sourceIndex) => (
            <div className="evidence-row" key={`${source.slug}-${sourceIndex}`}>
              <h3>{source.name}</h3>
              <p className="evidence-title">Título original: {source.title}</p>
              <dl className="event-dates">
                <div>
                  <dt>
                    {source.type === "hacker_news" ? "Submissão no HN" : "Publicação na fonte"}
                  </dt>
                  <dd>{dateTime(source.publishedAt)}</dd>
                </div>
                <div>
                  <dt>Primeira coleta deste item</dt>
                  <dd>{dateTime(source.collectedAt)}</dd>
                </div>
                <div>
                  <dt>Última coleta bem-sucedida da fonte</dt>
                  <dd>{dateTime(source.lastSuccessAt)}</dd>
                </div>
              </dl>
              <PublicationLink evidence={source} />
            </div>
          ))}
          <p className="timezone-note">
            Horários de Brasília (America/Sao_Paulo). O horário de uma submissão no HN não informa
            quando o artigo externo foi publicado.
          </p>
        </details>
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className="loading-state" role="status" aria-label="Carregando notícias">
      <span>Consultando o acervo…</span>
      {[0, 1, 2].map((key) => (
        <div key={key} className="skeleton-card" aria-hidden="true">
          <div />
          <div />
          <div />
        </div>
      ))}
    </div>
  );
}

export function RadarFeed() {
  const [filters, setFilters] = useState<Filters>(defaults);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<FeedPage | null>(null);
  const [sourceCatalog, setSourceCatalog] = useState<FeedSourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [light, setLight] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  const query = (cursor?: string) => {
    const params = new URLSearchParams({
      tab: filters.tab,
      category: filters.category,
      pageSize: "12",
    });
    if (filters.q) params.set("q", filters.q);
    if (filters.source) params.set("source", filters.source);
    if (cursor) params.set("cursor", cursor);
    return params;
  };

  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const params = new URLSearchParams({
      tab: filters.tab,
      category: filters.category,
      pageSize: "12",
    });
    if (filters.q) params.set("q", filters.q);
    if (filters.source) params.set("source", filters.source);
    fetch(`/api/feed?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 429
              ? "Muitas consultas em sequência. Aguarde um momento e tente novamente."
              : "Não foi possível carregar o acervo. Confira se o banco está disponível e tente novamente.",
          );
        return response.json() as Promise<FeedPage>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result);
          setSourceCatalog(result.sources);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Não foi possível carregar o acervo.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      activeRequest.current?.abort();
    };
  }, [filters, refresh]);

  function changeFilters(update: Partial<Filters>) {
    activeRequest.current?.abort();
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setPage(null);
    setFilters((current) => ({ ...current, ...update }));
  }

  function reload() {
    activeRequest.current?.abort();
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setRefresh((current) => current + 1);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    changeFilters({ q: draft.trim() });
  }

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/feed?${query(page.nextCursor)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("Não foi possível carregar mais notícias. Tente novamente.");
      const next = (await response.json()) as FeedPage;
      if (!controller.signal.aborted)
        setPage((current) =>
          current
            ? {
                ...next,
                items: [
                  ...current.items,
                  ...next.items.filter((item) => !current.items.some((old) => old.id === item.id)),
                ],
              }
            : next,
        );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Erro ao carregar notícias.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  const sources = page?.sources ?? sourceCatalog;
  const lastSuccess =
    sources
      .map((source) => source.lastSuccessAt)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null;
  const isCommunity = filters.tab === "community";

  return (
    <div className={`radar-app${light ? " light-theme" : ""}`}>
      <a className="skip-link" href="#noticias">
        Pular para as notícias
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Radar de IA — início">
          <span className="brand-symbol">
            <Icon name="radar" size={32} />
          </span>
          <span>
            radar<span className="brand-subtitle">IA & TECNOLOGIA</span>
          </span>
          <span className="brand-period">.</span>
        </Link>
        <div className="sidebar-label">EXPLORAR</div>
        <nav aria-label="Canais de notícias" className="sidebar-nav">
          <button
            className={!isCommunity ? "nav-item active" : "nav-item"}
            aria-current={!isCommunity ? "page" : undefined}
            onClick={() => changeFilters({ tab: "official", source: "" })}
          >
            <Icon name="grid" />
            <span>Notícias oficiais</span>
            {!isCommunity && <span className="nav-indicator" />}
          </button>
          <button
            className={isCommunity ? "nav-item active" : "nav-item"}
            aria-current={isCommunity ? "page" : undefined}
            onClick={() => changeFilters({ tab: "community", source: "" })}
          >
            <Icon name="community" />
            <span>Comunidade</span>
            {isCommunity && <span className="nav-indicator" />}
          </button>
          <a className="nav-item" href="#fontes">
            <Icon name="source" />
            <span>Fontes monitoradas</span>
          </a>
        </nav>
        <section className="sidebar-sources" id="fontes" aria-labelledby="source-heading">
          <div className="sidebar-label" id="source-heading">
            NO SEU RADAR <span>{sources.length || "—"}</span>
          </div>
          {!page && <p className="muted">As fontes aparecem após carregar o acervo.</p>}
          {sources.map((source) => (
            <div className="source-health" key={source.slug}>
              <span
                className={source.type === "hacker_news" ? "source-monogram hn" : "source-monogram"}
              >
                {source.type === "hacker_news" ? "Y" : "HF"}
              </span>
              <div>
                <strong>{source.type === "hacker_news" ? "Hacker News" : "Transformers"}</strong>
                <span>
                  {source.state === "active"
                    ? "Ativa"
                    : source.state === "unverified"
                      ? "Não verificada"
                      : "Coleta indisponível"}{" "}
                  · {source.editorialLevel === "official" ? "Oficial" : "Comunidade"}
                </span>
                <span>
                  {source.lastSuccessAt
                    ? `Último sucesso: ${dateTime(source.lastSuccessAt, true)}`
                    : "Nenhuma coleta concluída"}
                </span>
                {source.limited && (
                  <span className="source-caution">Cobertura parcial da janela</span>
                )}
              </div>
            </div>
          ))}
        </section>
        <div className="sidebar-bottom">
          <span className="small-radar">
            <Icon name="radar" size={48} />
          </span>
          <p>
            Informação com origem.
            <br />
            <strong>Leitura com contexto.</strong>
          </p>
          <span className="local-caption">ACESSO LOCAL · SEM CADASTRO</span>
        </div>
      </aside>

      <main className="main-content" id="noticias" tabIndex={-1}>
        <header className="topbar">
          <span>
            SEU RADAR <span className="breadcrumb-slash">/</span>{" "}
            <strong>{isCommunity ? "COMUNIDADE" : "NOTÍCIAS"}</strong>
          </span>
          <button
            className="icon-button"
            onClick={() => setLight((current) => !current)}
            aria-label={light ? "Ativar tema escuro" : "Ativar tema claro"}
          >
            <Icon name={light ? "moon" : "sun"} />
          </button>
        </header>
        <div className="page-inner">
          <section className="feed-intro">
            <div>
              <p className="eyebrow">
                <span className="accent-dot" /> IA EM PRIMEIRO LUGAR
              </p>
              <h1>
                Lançamentos,
                <br />
                pesquisas e  <span>discussões sobre IA</span>
              </h1>
              <p className="intro-description">
                Lançamentos e discussões, com a origem de cada informação.
                <br className="desktop-break" /> Um espaço para ler, conferir e acompanhar.
              </p>
            </div>
            <div className="hero-radar" aria-hidden="true">
              <div className="radar-ring ring-one" />
              <div className="radar-ring ring-two" />
              <div className="radar-ring ring-three" />
              <div className="radar-line" />
              <span className="radar-blip blip-one" />
              <span className="radar-blip blip-two" />
              <span className="radar-center" />
              <span className="radar-coordinate">FONTES · CONTEXTO · TEMPO</span>
            </div>
          </section>

          <div className="acervo-bar">
            <span>
              <Icon name="source" size={16} />
              {sources.length ? `${sources.length} fontes cadastradas` : "Fontes cadastradas"}
            </span>
            <span className="last-sync">
              Última coleta bem-sucedida:{" "}
              {lastSuccess ? (
                <time dateTime={lastSuccess}>{dateTime(lastSuccess, true)}</time>
              ) : (
                "—"
              )}
            </span>
            <span className="sort-label">↓ Mais recentes primeiro</span>
          </div>

          <details className="mobile-sources">
            <summary>
              Fontes monitoradas
              {sources.some((source) => source.limited) ? " · cobertura parcial" : ""}
            </summary>
            {sources.map((source) => (
              <div key={source.slug}>
                <strong>{source.name}</strong>
                <p>
                  {source.state === "active" ? "Ativa" : "Coleta indisponível"} · Último sucesso:{" "}
                  {dateTime(source.lastSuccessAt, true)}
                </p>
                {source.limited && <p>Cobertura parcial da janela de coleta.</p>}
              </div>
            ))}
          </details>
          <section className="feed-section" aria-label="Feed de notícias">
            <div className="feed-heading">
              <div>
                <h2>{isCommunity ? "Na comunidade" : "No radar, agora"}</h2>
                <p>
                  {isCommunity
                    ? "Relatos e discussões. Interesse da comunidade não significa confirmação."
                    : "Publicações de fontes primárias verificadas sobre os projetos monitorados."}
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={reload}
                disabled={loading}
                title="Recarregar notícias já coletadas"
              >
                <Icon name="refresh" size={17} />
                <span>Atualizar feed</span>
              </button>
            </div>

            <form className="search-form" onSubmit={search} role="search">
              <Icon name="search" />
              <label className="sr-only" htmlFor="news-search">
                Pesquisar no acervo coletado
              </label>
              <input
                id="news-search"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={120}
                placeholder="Buscar no acervo coletado…"
                type="search"
              />
              <button type="submit">
                Buscar <Icon name="chevron" size={14} />
              </button>
            </form>
            <div className="filter-bar">
              <div className="channel-tabs" role="group" aria-label="Origem das notícias">
                <button
                  aria-pressed={!isCommunity}
                  className={!isCommunity ? "selected" : ""}
                  onClick={() => changeFilters({ tab: "official", source: "" })}
                >
                  Oficiais
                </button>
                <button
                  aria-pressed={isCommunity}
                  className={isCommunity ? "selected" : ""}
                  onClick={() => changeFilters({ tab: "community", source: "" })}
                >
                  Comunidade
                </button>
              </div>
              <div className="select-filters">
                <label>
                  Tema
                  <select
                    value={filters.category}
                    onChange={(event) =>
                      changeFilters({ category: event.target.value as Filters["category"] })
                    }
                  >
                    <option value="ai">Inteligência artificial</option>
                    <option value="technology">Tecnologia geral</option>
                    <option value="all">Todos os temas</option>
                  </select>
                </label>
                <label>
                  Fonte
                  <select
                    value={filters.source}
                    onChange={(event) => changeFilters({ source: event.target.value })}
                  >
                    <option value="">Todas as fontes</option>
                    {sources
                      .filter(
                        (source) =>
                          source.editorialLevel === (isCommunity ? "community" : "official"),
                      )
                      .map((source) => (
                        <option key={source.slug} value={source.slug}>
                          {source.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>

            {filters.q && (
              <div className="search-context">
                Resultados para <strong>“{filters.q}”</strong>
                <button
                  onClick={() => {
                    setDraft("");
                    changeFilters({ q: "" });
                  }}
                >
                  Limpar pesquisa <span aria-hidden="true">×</span>
                </button>
              </div>
            )}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {!loading && page
                ? `${page.items.length} ${page.items.length === 1 ? "item carregado" : "itens carregados"}.`
                : "Carregando notícias."}
            </div>
            {error && (
              <div className="error-state" role="alert">
                <strong>O acervo está temporariamente indisponível.</strong>
                <p>{error}</p>
                <button onClick={reload}>Tentar novamente</button>
              </div>
            )}
            {loading ? (
              <LoadingCards />
            ) : page?.items.length ? (
              <>
                <div className="news-list">
                  {page.items.map((item, index) => (
                    <NewsCard item={item} index={index} key={item.id} />
                  ))}
                </div>
                <div className="pagination">
                  {page.nextCursor ? (
                    <button className="load-more" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? "Carregando…" : "Carregar mais notícias"}
                      <Icon name="chevron" size={16} />
                    </button>
                  ) : (
                    <p>Você chegou ao fim deste recorte do acervo.</p>
                  )}
                  <span>
                    {page.items.length}{" "}
                    {page.items.length === 1 ? "item exibido" : "itens exibidos"}
                  </span>
                </div>
              </>
            ) : (
              !error && (
                <div className="empty-state">
                  <Icon name={isCommunity ? "community" : "radar"} size={40} />
                  <h3>
                    {filters.q
                      ? "Nenhum resultado para esta busca"
                      : "Nenhuma notícia neste recorte"}
                  </h3>
                  <p>
                    {filters.q
                      ? "Tente outro termo ou amplie os filtros. A pesquisa consulta somente o acervo já coletado."
                      : isCommunity
                        ? "Você pode escolher todos os temas para ver outras discussões do acervo."
                        : "Os anúncios aparecem aqui após uma coleta bem-sucedida de uma fonte oficial."}
                  </p>
                  <button
                    onClick={() => {
                      setDraft("");
                      changeFilters({ q: "", source: "", category: isCommunity ? "all" : "ai" });
                    }}
                  >
                    Ajustar filtros
                  </button>
                </div>
              )
            )}
            {!loading && !page?.items.length && page?.nextCursor && (
              <div className="pagination">
                <button className="load-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Carregando…" : "Continuar no acervo"}
                  <Icon name="chevron" size={16} />
                </button>
              </div>
            )}
          </section>
          <footer className="page-footer">
            <span>
              RADAR <span className="accent-text">/</span> IA & TECNOLOGIA
            </span>
            <p>Leia a fonte. Preserve o contexto.</p>
            <span>Horários de Brasília</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
