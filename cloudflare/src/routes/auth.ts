import { Hono } from 'hono';
import type { Env } from '../env';
import {
  assertSameOrigin,
  createSessionCookie,
  isValidSession,
  requireAdmin,
  sessionClearCookie,
  sessionSetCookie
} from '../auth';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/login', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  if (!c.env.ADMIN_PASSWORD || !c.env.COOKIE_SIGNING_KEY) {
    return c.json({ success: false, error: '认证密钥未配置' }, 500);
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  if (!body.password || body.password !== c.env.ADMIN_PASSWORD) {
    return c.json({ success: false, error: '密码错误' }, 401);
  }

  const signingKey = c.env.COOKIE_SIGNING_KEY;
  const cookie = await createSessionCookie(signingKey);
  return c.json(
    { success: true },
    200,
    { 'Set-Cookie': sessionSetCookie(cookie) }
  );
});

authRoutes.get('/me', async (c) => {
  if (!c.env.COOKIE_SIGNING_KEY) {
    return c.json({ success: false, error: '认证密钥未配置' }, 500);
  }
  const signingKey = c.env.COOKIE_SIGNING_KEY;
  const authenticated = await isValidSession(
    c.req.header('Cookie') ?? null,
    signingKey
  );
  return c.json({ success: true, authenticated });
});

authRoutes.post('/logout', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  return c.json(
    { success: true },
    200,
    { 'Set-Cookie': sessionClearCookie() }
  );
});
