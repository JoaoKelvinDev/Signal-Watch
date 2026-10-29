import { actionSchema, executeAdminAction, readAdminDashboard } from "../../backend/admin/service";
import { getRequestDatabase } from "../../backend/database/request-client";
import {
  adminConfigured,
  validPassword,
  createAdminSession,
  validAdminSession,
  sameOriginMutation,
  sessionCookie,
} from "../../backend/admin/auth";
import { createFeedLimiter } from "../feed/rate-limit";
import { readAdminBody } from "./body";

const allowLogin = createFeedLimiter(8, 60000);
const headers = { "Cache-Control": "no-store" };
const reply = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET(request: Request) {
  if (!adminConfigured()) return reply("Administração não configurada no servidor.", 503);
  if (!validAdminSession(request.headers.get("cookie")))
    return reply("Autenticação necessária.", 401);
  try {
    const db = getRequestDatabase();
    return Response.json(await readAdminDashboard(db), { headers });
  } catch {
    return reply("Administração temporariamente indisponível.", 503);
  }
}

export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return reply("Origem ou formato inválido.", 403);
  if (!adminConfigured()) return reply("Administração não configurada no servidor.", 503);
  const parsed = actionSchema.safeParse(await readAdminBody(request).catch(() => null));
  if (!parsed.success) return reply("Operação inválida.", 400);
  const action = parsed.data;
  if (action.action === "login") {
    if (!allowLogin()) return reply("Aguarde um minuto antes de tentar novamente.", 429);
    if (!validPassword(action.password)) return reply("Credencial inválida.", 401);
    return Response.json(
      { ok: true },
      { headers: { ...headers, "Set-Cookie": sessionCookie(request, createAdminSession()) } },
    );
  }
  if (!validAdminSession(request.headers.get("cookie")))
    return reply("Autenticação necessária.", 401);
  if (action.action === "logout")
    return Response.json(
      { ok: true },
      { headers: { ...headers, "Set-Cookie": sessionCookie(request, "", true) } },
    );
  try {
    const db = getRequestDatabase();
    const result = await executeAdminAction(db, action);
    if (!result) return reply("Fonte não encontrada.", 404);
    if ("conflict" in result) return reply("Já existe uma fonte com esse identificador.", 409);
    if ("blocked" in result)
      return reply(
        "Execute o diagnóstico e a verificação de contrato antes de ativar esta fonte.",
        409,
      );
    return Response.json(result, { headers });
  } catch {
    return reply("Não foi possível concluir a operação.", 503);
  }
}
