import type { sources } from "./schema";

export const sourceCatalog: (typeof sources.$inferInsert)[] = [
  {
    slug: "huggingface-transformers",
    name: "Hugging Face Transformers — Releases",
    domain: "github.com",
    type: "github_releases",
    editorialLevel: "official",
    documentationUrl: "https://docs.github.com/en/rest/releases/releases",
    ownershipUrl: "https://huggingface.co/docs/transformers/en/installation",
    permissions:
      "Somente ID, título, versão, datas e links públicos. Sem corpos de release. Projeto Apache-2.0; termos da API GitHub se aplicam. Sem processamento por LLM.",
    config: { owner: "huggingface", repo: "transformers", maxPages: 2 },
    intervalSeconds: 900,
  },
  {
    slug: "hacker-news",
    name: "Hacker News — Novas histórias",
    domain: "news.ycombinator.com",
    type: "hacker_news",
    editorialLevel: "community",
    documentationUrl: "https://github.com/HackerNews/API",
    ownershipUrl: "https://github.com/HackerNews/API",
    permissions:
      "API pública oficial; somente ID, título, datas e links. Sem texto, comentários, autores ou LLM. Disponibilidade da API não concede licença sobre artigos externos. Exibição pública e retenção ampliada pendentes de revisão.",
    config: { maxItems: 25 },
    intervalSeconds: 1800,
  },
];
