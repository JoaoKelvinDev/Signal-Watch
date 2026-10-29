import { z } from "zod";
import { getRequestDatabase } from "../../backend/database/request-client";
import { readEvent } from "../../backend/feed/event";
import { allowFeedRequest } from "../feed/rate-limit";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Evento inválido." }, { status: 400, headers });
  if (!allowFeedRequest())
    return Response.json(
      { error: "Aguarde antes de consultar novamente." },
      { status: 429, headers },
    );
  try {
    const db = getRequestDatabase();
    const detail = await readEvent(db, id);
    return detail
      ? Response.json(detail, { headers })
      : Response.json({ error: "Evento não encontrado." }, { status: 404, headers });
  } catch {
    return Response.json(
      { error: "Evento temporariamente indisponível." },
      { status: 503, headers },
    );
  }
}
