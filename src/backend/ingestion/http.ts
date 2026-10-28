import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { IngestionError } from "./errors";
import type { JsonTransport } from "./contracts";

const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");

export function isPublicIPv4(address: string): boolean {
  return isIP(address) === 4 && !blocked.check(address, "ipv4");
}

export function validateTransportUrl(input: string): URL {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash
  )
    throw new IngestionError("UNSAFE_URL", true);
  const github =
    url.hostname === "api.github.com" && /^\/repos\/[\w.-]+\/[\w.-]+\/releases$/.test(url.pathname);
  const hn =
    url.hostname === "hacker-news.firebaseio.com" &&
    /^\/v0\/(newstories|item\/\d+)\.json$/.test(url.pathname);
  if (!github && !hn) throw new IngestionError("HOST_OR_PATH_NOT_ALLOWED", true);
  return url;
}

// DNS resolvido em cada consulta e endereço fixado no socket: sem janela para DNS rebinding.
// IPv4 apenas nesta etapa. Não recebe URLs arbitrárias de fontes ou artigos.
export const getJson: JsonTransport = async (input, headers, signal) => {
  signal.throwIfAborted();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new IngestionError("TIMEOUT")), 15000);
  const boundedSignal = AbortSignal.any([signal, timeout.signal]);
  try {
    return await requestJson(input, headers, boundedSignal);
  } catch (error) {
    if (boundedSignal.aborted) throw boundedSignal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

function resolveHost(
  hostname: string,
  signal: AbortSignal,
): Promise<{ address: string; family: number }[]> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true, family: 4 }).then(
      (addresses) => {
        signal.removeEventListener("abort", abort);
        resolve(addresses);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

const requestJson: JsonTransport = async (input, headers, signal) => {
  const url = validateTransportUrl(input);
  const addresses = await resolveHost(url.hostname, signal);
  if (!addresses.length || addresses.some(({ address }) => !isPublicIPv4(address)))
    throw new IngestionError("UNSAFE_DNS", true);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        agent: false,
        family: 4,
        headers: { "User-Agent": "RadarIA/0.1 (metadata collector)", ...headers },
        lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4),
      },
      (res) => {
        res.on("error", reject);
        const status = res.statusCode ?? 0;
        const responseHeaders: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(res.headers))
          responseHeaders[key] = Array.isArray(value) ? value.join(",") : value;
        if (status !== 200) {
          // Não precisamos do corpo de erros/redirects; fechar evita drenar conteúdo sem limite.
          res.destroy();
          resolve({ status, headers: responseHeaders, body: null });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) req.destroy(new IngestionError("BODY_TOO_LARGE"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            if (!responseHeaders["content-type"]?.includes("json"))
              throw new IngestionError("NOT_JSON");
            resolve({
              status,
              headers: responseHeaders,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
            });
          } catch {
            reject(new IngestionError("INVALID_JSON"));
          }
        });
      },
    );
    const abort = () =>
      req.destroy(signal.reason instanceof Error ? signal.reason : new IngestionError("ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
    req.on("close", () => signal.removeEventListener("abort", abort));
    req.on("error", reject);
    if (signal.aborted) abort();
    else req.end();
  });
};
