export class IngestionError extends Error {
  constructor(
    public readonly code: string,
    public readonly blocked = false,
    public readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}

export function checkStatus(
  status: number,
  headers: Record<string, string | undefined>,
  now = Date.now(),
) {
  if (status === 200 || status === 304) return;
  const retry = headers["retry-after"];
  const retryAfterMs = retry
    ? Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now)
    : 0;
  const resetMs = Number(headers["x-ratelimit-reset"] ?? 0) * 1000 - now;
  if (status === 429 || (status === 403 && (headers["x-ratelimit-remaining"] === "0" || retry))) {
    // Cabeçalhos externos não podem produzir Invalid Date/Infinity na fila.
    // Suspensões acima de sete dias exigem diagnóstico, em vez de encurtar Retry-After.
    if (
      !Number.isFinite(retryAfterMs) ||
      !Number.isFinite(resetMs) ||
      Math.max(retryAfterMs, resetMs) > 7 * 86400000
    )
      throw new IngestionError("INVALID_RETRY_WINDOW", true);
    throw new IngestionError("RATE_LIMIT", false, Math.max(60000, retryAfterMs || 0, resetMs || 0));
  }
  if (status === 401 || status === 403) throw new IngestionError(`HTTP_${status}`, true);
  throw new IngestionError(`HTTP_${status}`, status >= 400 && status < 500, retryAfterMs || 0);
}

export function retryDelay(attempt: number, retryAfterMs = 0, random = Math.random): number {
  return Math.max(
    retryAfterMs,
    Math.min(3600000, 30000 * 2 ** Math.min(attempt - 1, 7)) * (1 + random() * 0.2),
  );
}

export function safeError(error: unknown): IngestionError {
  // Nunca persistir mensagem externa, URL, payload, cabeçalho ou stack com possíveis segredos.
  return error instanceof IngestionError ? error : new IngestionError("INGESTION_FAILED");
}
