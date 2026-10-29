import { createHash, timingSafeEqual } from "node:crypto";
import { getRequestDatabase } from "../../backend/database/request-client";
import { runScheduledBatch } from "../../backend/worker/run";

export function validCronAuthorization(
  header: string | null,
  secret = process.env.CRON_SECRET,
): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32)
    return Response.json({ error: "Agendamento não configurado." }, { status: 503, headers });
  if (!validCronAuthorization(request.headers.get("authorization")))
    return Response.json({ error: "Não autorizado." }, { status: 401, headers });
  // Previews nunca coletam acidentalmente contra o banco de produção.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production")
    return Response.json({ error: "Coleta desativada neste ambiente." }, { status: 409, headers });
  try {
    const db = getRequestDatabase();
    const result = await runScheduledBatch(db, AbortSignal.timeout(230000));
    return Response.json(result, { headers, status: result.failed ? 207 : 200 });
  } catch {
    return Response.json(
      { error: "Coleta temporariamente indisponível." },
      { status: 503, headers },
    );
  }
}
