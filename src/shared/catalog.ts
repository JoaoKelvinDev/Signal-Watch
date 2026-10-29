export const topics = [
  "models",
  "agents",
  "programming",
  "image",
  "audio",
  "video",
  "research",
  "infrastructure",
  "security",
  "pricing",
  "api",
] as const;
export const topicLabels: Record<(typeof topics)[number], string> = {
  models: "Modelos",
  agents: "Agentes",
  programming: "Programação",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  research: "Pesquisa",
  infrastructure: "Infraestrutura",
  security: "Segurança",
  pricing: "Preços",
  api: "API",
};
export const eventTypes = [
  "release",
  "update",
  "research",
  "opinion",
  "incident",
  "discussion",
] as const;
export const eventTypeLabels: Record<string, string> = {
  release: "Lançamento",
  update: "Atualização",
  research: "Pesquisa",
  opinion: "Opinião",
  incident: "Incidente",
  discussion: "Discussão",
};
export const editorialStatuses = [
  "official_announcement",
  "corroborated",
  "community_report",
  "unverified",
  "disputed",
  "corrected",
] as const;
export const editorialStatusLabels: Record<string, string> = {
  official_announcement: "Anúncio oficial",
  corroborated: "Corroborado",
  community_report: "Relato comunitário",
  unverified: "Não verificado",
  disputed: "Contestado",
  corrected: "Corrigido",
};
