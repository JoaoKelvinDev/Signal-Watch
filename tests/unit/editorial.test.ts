import { describe, expect, it } from "vitest";
import {
  classify,
  dedupKey,
  isVerifiedPrimary,
  knownVersion,
  normalizedText,
  semanticHash,
  type EditorialItem,
  type EditorialSource,
} from "../../src/backend/editorial/classify";

function source(overrides: Partial<EditorialSource> = {}): EditorialSource {
  return {
    id: "source",
    slug: "huggingface-transformers",
    name: "Hugging Face Transformers",
    domain: "github.com",
    type: "github_releases",
    editorialLevel: "official",
    documentationUrl: "https://docs.github.com/en/rest/releases/releases",
    ownershipUrl: "https://huggingface.co/docs/transformers/en/installation",
    verifiedAt: new Date(),
    permissions: "Metadados",
    config: { owner: "huggingface", repo: "transformers" },
    state: "active",
    intervalSeconds: 900,
    nextRunAt: new Date(),
    cursor: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    quota: null,
    ...overrides,
  };
}
function item(overrides: Partial<EditorialItem> = {}): EditorialItem {
  return {
    id: "item",
    sourceId: "source",
    externalId: "1",
    originalUrl: "https://github.com/huggingface/transformers/releases/tag/v1.2.3",
    canonicalUrl: "https://github.com/huggingface/transformers/releases/tag/v1.2.3",
    discussionUrl: null,
    title: "Transformers v1.2.3",
    language: null,
    excerpt: null,
    publishedAt: null,
    updatedAt: null,
    collectedAt: new Date(),
    lastSeenAt: new Date(),
    contentHash: "fixture",
    version: "v1.2.3",
    prerelease: false,
    processingState: "pending",
    ...overrides,
  };
}

describe("classificação editorial conservadora", () => {
  it("anúncio oficial requer fonte verificada e URL do projeto associado", () => {
    expect(classify(item(), source())).toMatchObject({
      title: "Transformers v1.2.3: release publicada",
      category: "ai",
      editorialStatus: "official_announcement",
      companies: ["Hugging Face"],
      products: ["Transformers"],
    });
    expect(isVerifiedPrimary(source({ verifiedAt: null }), item())).toBe(false);
    expect(
      isVerifiedPrimary(
        source(),
        item({ canonicalUrl: "https://github.com/outro/projeto/releases/tag/v1.2.3" }),
      ),
    ).toBe(false);
  });
  it("não confirma relato comunitário nem inventa resumo/tradução do título", () => {
    const result = classify(
      item({ title: "OpenAI launches a new model" }),
      source({ type: "hacker_news", editorialLevel: "community", config: {} }),
    );
    expect(result).toMatchObject({
      title: "OpenAI launches a new model",
      editorialStatus: "community_report",
      category: "ai",
      companies: ["OpenAI"],
      type: "discussion",
    });
    expect(result).not.toHaveProperty("summary");
  });
  it("mantém tecnologia geral fora da categoria IA quando título é insuficiente", () => {
    const result = classify(
      item({ title: "A database benchmark" }),
      source({ type: "hacker_news", editorialLevel: "community", config: {} }),
    );
    expect(result).toMatchObject({ category: "technology", companies: [], products: [] });
  });
  it("não atribui meta-analysis à empresa Meta", () => {
    const result = classify(
      item({ title: "A meta-analysis of language models" }),
      source({ type: "hacker_news", editorialLevel: "community", config: {} }),
    );
    expect(result.companies).toEqual([]);
  });
  it("separa versões e URLs semanticamente diferentes", () => {
    expect(dedupKey(item())).not.toBe(dedupKey(item({ version: "v2" })));
    expect(dedupKey(item())).not.toBe(
      dedupKey(item({ canonicalUrl: item().canonicalUrl + "?edition=2" })),
    );
  });
  it("cobertura HN do mesmo link de release identifica a mesma versão", () => {
    expect(knownVersion(item({ version: null }))).toBe("v1.2.3");
    expect(dedupKey(item())).toBe(dedupKey(item({ version: null })));
  });
  it("mudança de formatação não é alteração factual", () => {
    expect(semanticHash(normalizedText("Texto\n  original"))).toBe(
      semanticHash(normalizedText("Texto original")),
    );
  });
});
