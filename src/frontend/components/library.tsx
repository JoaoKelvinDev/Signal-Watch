"use client";
import { useState } from "react";
import Link from "next/link";
import type { FeedItem } from "../../shared/contracts/feed";
import { updateLibrary } from "../library-store";
import { useLibrary } from "../use-library";
import { UtilityPage } from "./utility-page";
import { topicLabels, topics } from "../../shared/catalog";

export function ItemActions({ item }: { item: Pick<FeedItem, "id" | "title"> }) {
  const library = useLibrary(),
    current = library.items.find((entry) => entry.id === item.id);
  const [error, setError] = useState("");
  function toggle(field: "read" | "saved") {
    const success = updateLibrary((value) => {
      const previous = value.items.find((entry) => entry.id === item.id) ?? {
        id: item.id,
        title: item.title,
        read: false,
        saved: false,
      };
      const next = { ...previous, title: item.title.slice(0, 2000), [field]: !previous[field] };
      return {
        ...value,
        items: [...value.items.filter((entry) => entry.id !== item.id), next]
          .filter((entry) => entry.read || entry.saved)
          .slice(-1000),
      };
    });
    setError(success ? "" : "O navegador não permitiu salvar. Verifique o armazenamento local.");
  }
  return (
    <div className="item-actions">
      <button type="button" aria-pressed={current?.saved ?? false} onClick={() => toggle("saved")}>
        {current?.saved ? "★ Salvo" : "☆ Salvar"}
      </button>
      <button type="button" aria-pressed={current?.read ?? false} onClick={() => toggle("read")}>
        {current?.read ? "✓ Lido" : "Marcar como lido"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function PreferencesView() {
  const library = useLibrary();
  const [message, setMessage] = useState("");
  return (
    <UtilityPage>
      <Link href="/">← Voltar ao Radar</Link>
      <h1>Preferências e itens salvos</h1>
      <p>
        Dados mantidos somente neste navegador, sem cadastro. Limpar os dados do navegador remove as
        preferências e os últimos 1.000 itens salvos ou lidos.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const ok = updateLibrary((value) => ({
            ...value,
            theme: data.get("theme") === "light" ? "light" : "dark",
            company: String(data.get("company") ?? "").trim(),
            topic: topics.find((topic) => topic === data.get("topic")) ?? "",
          }));
          setMessage(
            ok
              ? "Preferências salvas. Serão aplicadas ao voltar ao feed."
              : "Não foi possível salvar neste navegador.",
          );
        }}
      >
        <label>
          Tema visual
          <select name="theme" defaultValue={library.theme} key={`theme-${library.theme}`}>
            <option value="dark">Escuro</option>
            <option value="light">Claro</option>
          </select>
        </label>
        <label>
          Empresa preferida
          <input
            name="company"
            maxLength={80}
            defaultValue={library.company}
            key={`company-${library.company}`}
          />
        </label>
        <label>
          Tema preferido
          <select name="topic" defaultValue={library.topic} key={`topic-${library.topic}`}>
            <option value="">Todos</option>
            {topics.map((topic) => (
              <option key={topic} value={topic}>
                {topicLabels[topic]}
              </option>
            ))}
          </select>
        </label>
        <button>Salvar preferências</button>
      </form>
      <p role="status">{message}</p>
      <h2>Favoritos</h2>
      {!library.items.some((item) => item.saved) && <p>Nenhum favorito ainda.</p>}
      {library.items
        .filter((item) => item.saved)
        .reverse()
        .map((item) => (
          <section key={item.id}>
            <Link href={`/eventos/${item.id}`}>{item.title}</Link>
            <ItemActions item={item} />
          </section>
        ))}
      <h2>Itens lidos</h2>
      {library.items
        .filter((item) => item.read)
        .reverse()
        .map((item) => (
          <section key={item.id}>
            <Link href={`/eventos/${item.id}`}>{item.title}</Link>
            <ItemActions item={item} />
          </section>
        ))}
    </UtilityPage>
  );
}
