import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import type { Env } from '../env';
import { assertSameOrigin, requireAdmin } from '../auth';
import { DeploymentError } from '../errors';
import { listAllDomains } from '../domains';
import { deleteSiteObjects } from '../storage';
import {
  deleteSiteRecords,
  getSiteById,
  listSiteSummaries
} from '../repositories/sites';

export const siteRoutes = new Hono<{ Bindings: Env }>();

function errorStatus(error: DeploymentError): ContentfulStatusCode {
  if (error.code === 'SITE_NOT_FOUND') return 404;
  return 400;
}

function errorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
  if (error instanceof DeploymentError) {
    return c.json({ success: false, error: error.message, code: error.code }, errorStatus(error));
  }
  return c.json({ success: false, error: '站点管理操作失败' }, 500);
}

function previewUrl(siteId: string, env: Env): string {
  const prefix = (env.SITE_PATH_PREFIX || '/s').replace(/\/$/, '');
  return `${prefix}/${encodeURIComponent(siteId)}/`;
}

siteRoutes.get('/', async (c) => {
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const [summaries, domains] = await Promise.all([
      listSiteSummaries(c.env.DB),
      listAllDomains(c.env.DB)
    ]);
    const domainsBySite = new Map<string, string[]>();
    for (const domain of domains) {
      const siteDomains = domainsBySite.get(domain.site_id) || [];
      siteDomains.push(domain.hostname);
      domainsBySite.set(domain.site_id, siteDomains);
    }

    return c.json({
      success: true,
      sites: summaries.map((site) => ({
        siteId: site.id,
        slug: site.slug,
        name: site.name,
        entryPath: site.entry_path,
        currentVersionId: site.current_version_id,
        currentStatus: site.current_status,
        currentFileCount: site.current_file_count,
        currentTotalBytes: site.current_total_bytes,
        versionCount: site.version_count,
        domains: domainsBySite.get(site.id) || [],
        createdAt: site.created_at,
        updatedAt: site.updated_at,
        previewUrl: previewUrl(site.id, c.env)
      }))
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

siteRoutes.delete('/:siteId', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const siteId = c.req.param('siteId');
    if (!await getSiteById(c.env.DB, siteId)) {
      throw new DeploymentError('SITE_NOT_FOUND', '站点不存在');
    }

    // Keep D1 metadata if R2 cleanup fails so the same deletion can be retried safely.
    const deletedObjects = await deleteSiteObjects(c.env.SITES, siteId);
    await deleteSiteRecords(c.env.DB, siteId);
    return c.json({ success: true, siteId, deletedObjects });
  } catch (error) {
    return errorResponse(c, error);
  }
});
