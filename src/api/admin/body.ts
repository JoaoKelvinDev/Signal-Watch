// Corpo pequeno e prazo único, inclusive para um cliente que nunca encerra o stream.
export async function readAdminBody(request: Request, timeoutMs = 5000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  let size = 0;
  const chunks: Uint8Array[] = [];
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) {
        cancel();
        throw new Error("BODY_LIMIT");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (signal.aborted) cancel();
    reader.releaseLock();
  }
}
