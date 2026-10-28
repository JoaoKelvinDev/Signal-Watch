import { createHash } from "node:crypto";
import type { sourceItems, sources } from "../database/schema";

export type EditorialItem = typeof sourceItems.$inferSelect;
export type EditorialSource = typeof sources.$inferSelect;

const aiTerms =
  /\b(ai|ia|llms?|gpt(?:-?\d+)?|chatgpt|claude|anthropic|openai|gemini|deepmind|mistral|hugging\s*face|transformers|machine learning|artificial intelligence|intelig[eê]ncia artificial|diffusion|neural networks?|language models?|modelos? de linguagem)\b/i;
const companies = [
  ["OpenAI", /\b(openai|chatgpt)\b/i],
  ["Anthropic", /\b(anthropic|claude)\b/i],
  ["Google", /\b(google|deepmind|gemini)\b/i],
  ["Microsoft", /\bmicrosoft\b/i],
  ["Meta", /\bmeta (ai|platforms)\b/i],
  ["NVIDIA", /\bnvidia\b/i],
  ["Hugging Face", /\bhugging\s*face\b/i],
  ["Mistral", /\bmistral\b/i],
] as const;

export function normalizedText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function knownVersion(item: Pick<EditorialItem, "version" | "canonicalUrl">): string | null {
  if (item.version) return item.version;
  const url = new URL(item.canonicalUrl);
  const match =
    url.hostname === "github.com" ? url.pathname.match(/\/releases\/tag\/([^/]+)$/) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function dedupKey(item: Pick<EditorialItem, "version" | "canonicalUrl">): string {
  // Só URLs idênticas e versões compatíveis: sem agrupamento por semelhança de título.
  return createHash("sha256")
    .update(JSON.stringify([item.canonicalUrl, knownVersion(item)]))
    .digest("hex");
}

export function isVerifiedPrimary(source: EditorialSource, item: EditorialItem): boolean {
  if (
    source.type !== "github_releases" ||
    source.editorialLevel !== "official" ||
    !source.verifiedAt
  )
    return false;
  const { owner, repo } = source.config;
  if (typeof owner !== "string" || typeof repo !== "string") return false;
  const url = new URL(item.canonicalUrl);
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.pathname.startsWith(`/${owner}/${repo}/releases/`)
  );
}

export function classify(item: EditorialItem, source: EditorialSource) {
  const transformers =
    source.type === "github_releases" &&
    source.config.owner === "huggingface" &&
    source.config.repo === "transformers";
  const primary = isVerifiedPrimary(source, item);
  const version = knownVersion(item);
  return {
    title:
      primary && transformers && version
        ? `Transformers ${version}: ${item.prerelease ? "prévia publicada" : "release publicada"}`
        : normalizedText(item.title),
    category: transformers || aiTerms.test(item.title) ? "ai" : "technology",
    companies: transformers
      ? ["Hugging Face"]
      : companies.filter(([, expression]) => expression.test(item.title)).map(([name]) => name),
    products: transformers ? ["Transformers"] : [],
    version,
    type: source.type === "github_releases" ? "release" : "discussion",
    editorialStatus: primary
      ? "official_announcement"
      : source.editorialLevel === "community"
        ? "community_report"
        : "unverified",
    rationale: primary
      ? "Release publicada no repositório associado à fonte oficial verificada. Alegações do emissor não foram verificadas de forma independente."
      : source.editorialLevel === "community"
        ? "Submissão comunitária. O link externo não foi lido; o título e a popularidade não confirmam a alegação."
        : "Procedência primária ainda não verificada para este item.",
  };
}

export function semanticHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
