import { Hono } from 'hono';
import type { Env } from './env';
import { getSiteById } from './repositories/sites';
import { isManagementHost, isSiteRequestHost, requestHostname, resolveSiteByHost } from './routing';
import { authRoutes } from './routes/auth';
import { domainRoutes } from './routes/domains';
import { deploymentRoutes } from './routes/deployments';
import { siteRoutes } from './routes/sites';
import { serveSite } from './site-responder';
import { rateLimit } from './cost-controls';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const limited = await rateLimit(c.req.raw, c.env);
  if (limited) return limited;
  await next();
});

app.use('/api/*', async (c, next) => {
  if (await isSiteRequestHost(c.env.DB, c.req.raw, c.env)) return c.notFound();
  await next();
});

app.get('/api/health', (c) => c.json({
  ok: true,
  service: 'quickshare-cloudflare'
}));

app.route('/api/auth', authRoutes);
app.route('/api/deployments', deploymentRoutes);
app.route('/api/domains', domainRoutes);
app.route('/api/sites', siteRoutes);

app.all('*', async (c) => {
  const pathPrefix = (c.env.SITE_PATH_PREFIX || '/s').replace(/\/$/, '');
  const pathname = new URL(c.req.url).pathname;
  if (isManagementHost(c.req.raw, c.env) && (pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`))) {
    const rest = pathname.slice(pathPrefix.length + 1);
    const [siteId] = rest.split('/');
    if (!siteId || siteId.includes('%')) return c.notFound();
    const site = await getSiteById(c.env.DB, decodeURIComponent(siteId));
    if (!site) return c.notFound();
    return serveSite(c.req.raw, c.env, site, { preview: true, waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx) });
  }

  if (await isSiteRequestHost(c.env.DB, c.req.raw, c.env)) {
    const site = await resolveSiteByHost(c.env.DB, requestHostname(c.req.raw), c.env);
    if (!site) return c.notFound();
    return serveSite(c.req.raw, c.env, site, { waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx) });
  }

  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
