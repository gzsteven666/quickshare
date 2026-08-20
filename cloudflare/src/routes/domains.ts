import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import type { Env } from '../env';
import { assertSameOrigin, requireAdmin } from '../auth';
import { DeploymentError } from '../errors';
import {
  createDomainMapping,
  deleteDomainMapping,
  listDomains,
  normalizeDomainHostname
} from '../domains';

export const domainRoutes = new Hono<{ Bindings: Env }>();

function errorStatus(error: DeploymentError): ContentfulStatusCode {
  if (error.code === 'SITE_NOT_FOUND') return 404;
  if (error.code === 'DOMAIN_IN_USE') return 409;
  return 400;
}

function errorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
  if (error instanceof DeploymentError) {
    return c.json({ success: false, error: error.message, code: error.code }, errorStatus(error));
  }
  return c.json({ success: false, error: '域名映射处理失败' }, 500);
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new DeploymentError('INVALID_JSON', '请求 JSON 无效');
  }
}

function instructions(hostname: string, env: Env) {
  const base = env.SITES_BASE_DOMAIN?.toLowerCase().replace(/\.$/, '');
  const wildcard = Boolean(base && hostname.endsWith(`.${base}`));
  return {
    mode: wildcard ? 'wildcard-route' : 'custom-domain',
    steps: wildcard
      ? [
          `在 Cloudflare DNS 中确认 *.${base} 已开启代理（橙云）。`,
          `在 Worker Routes 中添加 *.${base}/*，指向 QuickShare Worker。`,
          `访问 ${hostname} 验证站点。`
        ]
      : [
          `在 Cloudflare Worker 的 Domains & Routes 中添加精确 Custom Domain：${hostname}。`,
          '确认该域名属于当前 Cloudflare 账户并已开启代理。',
          `访问 https://${hostname}/ 验证站点。`
        ],
    note: 'QuickShare 只保存域名映射，不会保存或调用 Cloudflare API Token。'
  };
}

domainRoutes.get('/', async (c) => {
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  const siteId = c.req.query('siteId');
  if (!siteId) return c.json({ success: false, error: '缺少 siteId', code: 'SITE_ID_REQUIRED' }, 400);
  try {
    return c.json({ success: true, domains: await listDomains(c.env.DB, siteId) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

domainRoutes.post('/', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson<{ siteId?: unknown; hostname?: unknown }>(c.req.raw);
    if (typeof body.siteId !== 'string' || !body.siteId) {
      throw new DeploymentError('SITE_ID_REQUIRED', '缺少 siteId');
    }
    const hostname = normalizeDomainHostname(body.hostname);
    const domain = await createDomainMapping(c.env.DB, body.siteId, hostname);
    return c.json({
      success: true,
      domain,
      instructions: instructions(hostname, c.env)
    }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

domainRoutes.delete('/:hostname', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;
  try {
    const siteId = c.req.query('siteId');
    if (!siteId) throw new DeploymentError('SITE_ID_REQUIRED', '缺少 siteId');
    const hostname = normalizeDomainHostname(c.req.param('hostname'));
    const deleted = await deleteDomainMapping(c.env.DB, hostname, siteId);
    return c.json({ success: true, deleted });
  } catch (error) {
    return errorResponse(c, error);
  }
});
