// Defesa em leitura também cobre registros legados ou alterados diretamente no banco.
export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return value;
  } catch {
    return null;
  }
}
