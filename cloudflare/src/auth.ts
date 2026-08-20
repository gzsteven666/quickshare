import type { Env } from './env';

export const SESSION_COOKIE = 'quickshare_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importHmacKey(secret: string, usage: 'sign' | 'verify') {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
  return key;
}

async function signHmac(value: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, 'sign');
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function verifyHmac(value: string, secret: string, signature: Uint8Array): Promise<boolean> {
  const key = await importHmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, signature as unknown as BufferSource, encoder.encode(value));
}

function cookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';')) {
    const [name, ...valueParts] = item.trim().split('=');
    if (name === SESSION_COOKIE) return valueParts.join('=') || null;
  }
  return null;
}

export async function createSessionCookie(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `admin:${expiresAt}`;
  const signature = await signHmac(payload, secret);
  return `${payload}.${signature}`;
}

export async function isValidSession(
  cookieHeader: string | null,
  secret: string,
  now = Date.now()
): Promise<boolean> {
  const value = cookieValue(cookieHeader);
  if (!value) return false;

  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const payloadParts = payload.split(':');
  if (payloadParts.length !== 2 || payloadParts[0] !== 'admin') return false;

  const expiresAt = Number(payloadParts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;

  try {
    return await verifyHmac(payload, secret, fromBase64Url(signature));
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: Request): Response | null {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin && origin !== requestOrigin) {
    return Response.json({ success: false, error: '跨域请求被拒绝' }, { status: 403 });
  }
  return null;
}

export async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.COOKIE_SIGNING_KEY) {
    return Response.json({ success: false, error: '认证密钥未配置' }, { status: 500 });
  }
  if (!(await isValidSession(request.headers.get('Cookie'), env.COOKIE_SIGNING_KEY))) {
    return Response.json({ success: false, error: '需要管理员登录' }, { status: 401 });
  }
  return null;
}

export function sessionSetCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
