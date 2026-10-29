import type { PoolConfig } from "pg";

export function databaseConfig(
  value: string | undefined,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  if (!value) throw new Error("DATABASE_URL é obrigatória no servidor.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Configuração do banco inválida.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Protocolo de banco inválido.");
  const supabase = /\.(supabase\.co|supabase\.com)$/.test(url.hostname);
  const secure = supabase || env.VERCEL === "1";
  if (secure) {
    if (url.searchParams.get("sslmode") === "disable" || url.searchParams.get("ssl") === "false")
      throw new Error("O banco em nuvem exige TLS verificado.");
    // A URL não pode substituir rejectUnauthorized ou carregar certificados do filesystem.
    for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"])
      url.searchParams.delete(key);
  }
  return {
    connectionString: url.href,
    max: secure ? 1 : 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ...(secure
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT.replace(/\\n/g, "\n") } : {}),
          },
        }
      : { options: "-c timezone=UTC" }),
  };
}
