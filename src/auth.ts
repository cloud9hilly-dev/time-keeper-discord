export interface SessionUser {
  id: string;
  username: string;
  avatar?: string | null;
  exp: number;
  demo?: boolean;
}

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function signValue<T>(payload: T, secret: string): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyValue<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = await hmac(secret, body);
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i += 1) mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function getSession(request: Request, secret: string): Promise<SessionUser | null> {
  const session = await verifyValue<SessionUser>(readCookie(request, "tk_session"), secret);
  return session && session.exp > Math.floor(Date.now() / 1000) ? session : null;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return bytesToBase64Url(bytes);
}
