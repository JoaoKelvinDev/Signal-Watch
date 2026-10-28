import { createHash } from "node:crypto";
import type { NormalizedItem } from "./contracts";

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("URL de conteúdo inválida.");
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid", "msclkid"].includes(key.toLowerCase()))
      url.searchParams.delete(key);
  }
  // Fragmentos e parâmetros semânticos são preservados.
  return url.href;
}

export function withHash(item: Omit<NormalizedItem, "contentHash">): NormalizedItem {
  return { ...item, contentHash: createHash("sha256").update(JSON.stringify(item)).digest("hex") };
}
