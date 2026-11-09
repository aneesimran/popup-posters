export const SESSION_COOKIE = "pp_session";

/** Cookie value derived from the passcode, so changing APP_PASSCODE logs everyone out. */
export async function sessionToken(): Promise<string> {
  const passcode = process.env.APP_PASSCODE ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("popup-posters-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The Android app sends `Authorization: Bearer <APP_API_KEY>`. */
export function hasApiKey(req: Request): boolean {
  const key = process.env.APP_API_KEY ?? "";
  const header = req.headers.get("authorization") ?? "";
  return key.length >= 16 && header.startsWith("Bearer ") && safeEqual(header.slice(7), key);
}
