import { openDatabase } from "../../backend/database/client";
import { InvalidFeedParameters, parseFeedParameters } from "../../backend/feed/parameters";
import { readFeed } from "../../backend/feed/repository";
import { allowFeedRequest } from "./rate-limit";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!allowFeedRequest()) {
    return Response.json(
      { error: "Muitas consultas. Aguarde um minuto e tente novamente." },
      {
        status: 429,
        headers: { ...headers, "Retry-After": "60" },
      },
    );
  }
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    const parameters = parseFeedParameters(new URL(request.url).searchParams);
    database = openDatabase();
    return Response.json(await readFeed(database.db, parameters), { headers });
  } catch (error) {
    if (error instanceof InvalidFeedParameters) {
      return Response.json(
        { error: "Parâmetros de pesquisa ou paginação inválidos." },
        { status: 400, headers },
      );
    }
    return Response.json(
      { error: "As notícias estão temporariamente indisponíveis. Tente novamente." },
      { status: 503, headers },
    );
  } finally {
    await database?.close();
  }
}
