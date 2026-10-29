import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const adminCookie = "radar_admin";
const lifetime = 12 * 60 * 60;
function secret(): string | null {
  const value = process.env.ADMIN_PASSWORD;
  return value && value.length >= 32 && value.length <= 256 ? value : null;
}
export function adminConfigured() {
  return secret() !== null;
}
export function validPassword(password: string): boolean {
  const configured = secret();
  if (!configured || password.length > 256) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(password), hash(configured));
}
function signature(payload: string, key: string) {
  return createHmac("sha256", key).update(`radar-admin-v1:${payload}`).digest("base64url");
}
export function createAdminSession(now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("Administração não configurada.");
  const payload = `${Math.floor(now / 1000) + lifetime}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${signature(payload, key)}`;
}
export function validAdminSession(cookie: string | null, now = Date.now()): boolean {
  const key = secret();
  const value = cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${adminCookie}=`))
    ?.slice(adminCookie.length + 1);
  if (!key || !value || value.length > 200) return false;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const expiry = Number(match[1]),
    seconds = Math.floor(now / 1000);
  if (expiry <= seconds || expiry > seconds + lifetime) return false;
  const expected = signature(`${match[1]}.${match[2]}`, key);
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected));
}
function expectedPublicOrigin(request: Request): string | null {
  const configured =
    process.env.APP_ORIGIN ||
    (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  let expected: string;
  try {
    const url = new URL(configured ?? request.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    expected = url.origin;
  } catch {
    return null;
  }
  // Next pode construir a URL interna com localhost. Aceitar Host somente para loopback no desenvolvimento local.
  const host = request.headers.get("host");
  if (
    !configured &&
    process.env.VERCEL !== "1" &&
    host &&
    /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)
  )
    expected = `http://${host}`;
  return expected;
}
export function sameOriginMutation(request: Request): boolean {
  const expected = expectedPublicOrigin(request);
  return (
    expected !== null &&
    request.headers.get("origin") === expected &&
    request.headers.get("content-type")?.split(";")[0].trim() === "application/json"
  );
}
export function sessionCookie(request: Request, value: string, clear = false): string {
  return `${adminCookie}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : lifetime}${process.env.VERCEL === "1" || expectedPublicOrigin(request)?.startsWith("https://") ? "; Secure" : ""}`;
}
