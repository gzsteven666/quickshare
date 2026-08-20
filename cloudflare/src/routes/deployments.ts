import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../env';
import { DeploymentError } from '../errors';
import {
  createSite,
  createVersion,
  getFile,
  getSiteById,
  getSiteBySlug,
  getVersionById,
  markFileUploaded,
  recordManifest,
  finalizeVersion
} from '../repositories/sites';
import {
  assertSameOrigin,
  requireAdmin
} from '../auth';
import {
  deploymentLimits,
  normalizeRelativePath,
  validateManifest,
  type DeploymentManifestInput
} from '../validation';

export const deploymentRoutes = new Hono<{ Bindings: Env }>();

function errorStatus(error: DeploymentError): ContentfulStatusCode {
  switch (error.code) {
    case 'VERSION_NOT_FOUND':
    case 'FILE_NOT_IN_MANIFEST':
    case 'ENTRY_NOT_IN_MANIFEST':
    case 'ENTRY_NOT_UPLOADED':
    case 'SITE_NOT_FOUND':
      return 404;
    case 'FILE_ALREADY_UPLOADED':
    case 'VERSION_NOT_UPLOADING':
    case 'DUPLICATE_SLUG':
      return 409;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    default:
      return 400;
  }
}

function errorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
  if (error instanceof DeploymentError) {
    return c.json({ success: false, error: error.message, code: error.code }, errorStatus(error));
  }
  return c.json({ success: false, error: '发布请求处理失败' }, 500);
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new DeploymentError('INVALID_JSON', '请求 JSON 无效');
  }
}

function sitePreviewUrl(siteId: string, env: Env): string {
  const prefix = (env.SITE_PATH_PREFIX || '/s').replace(/\/$/, '');
  return `${prefix}/${encodeURIComponent(siteId)}/`;
}

deploymentRoutes.post('/', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const input = await readJson<DeploymentManifestInput>(c.req.raw);
    const manifest = validateManifest(input, c.env);
    let site = await getSiteBySlug(c.env.DB, manifest.slug);
    if (!site) {
      const siteId = crypto.randomUUID();
      try {
        await createSite(c.env.DB, {
          id: siteId,
          slug: manifest.slug,
          name: manifest.name,
          entry_path: manifest.entryPath
        });
      } catch (error) {
        if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
          throw new DeploymentError('DUPLICATE_SLUG', '站点 slug 已存在，请重试');
        }
        throw error;
      }
      site = await getSiteById(c.env.DB, siteId);
    }
    if (!site) throw new DeploymentError('SITE_NOT_FOUND', '站点创建失败');

    const versionId = crypto.randomUUID();
    await createVersion(c.env.DB, {
      id: versionId,
      site_id: site.id,
      file_count: manifest.files.length,
      total_bytes: manifest.totalBytes
    });
    await recordManifest(c.env.DB, versionId, manifest.files);

    return c.json({
      success: true,
      siteId: site.id,
      slug: site.slug,
      versionId,
      entryPath: manifest.entryPath,
      fileCount: manifest.files.length,
      totalBytes: manifest.totalBytes,
      previewUrl: sitePreviewUrl(site.id, c.env)
    }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

deploymentRoutes.put('/:versionId/files', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const versionId = c.req.param('versionId');
    const version = await getVersionById(c.env.DB, versionId);
    if (!version) throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
    if (version.status !== 'uploading') {
      throw new DeploymentError('VERSION_NOT_UPLOADING', '发布版本已经结束上传');
    }

    const path = normalizeRelativePath(c.req.query('path'));
    const manifestFile = await getFile(c.env.DB, versionId, path);
    if (!manifestFile) throw new DeploymentError('FILE_NOT_IN_MANIFEST', '文件不在发布清单中');
    if (manifestFile.uploaded_at !== null) {
      throw new DeploymentError('FILE_ALREADY_UPLOADED', '文件已经上传');
    }

    const maxFileBytes = deploymentLimits(c.env).maxFileBytes;
    const declaredLength = c.req.header('Content-Length');
    if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== manifestFile.size)) {
      throw new DeploymentError('FILE_METADATA_MISMATCH', 'Content-Length 与发布清单不一致');
    }
    if (manifestFile.size > maxFileBytes) {
      throw new DeploymentError('FILE_LIMIT_EXCEEDED', '文件大小超过限制');
    }

    const body = await c.req.raw.arrayBuffer();
    if (body.byteLength !== manifestFile.size) {
      throw new DeploymentError('FILE_METADATA_MISMATCH', '上传文件大小与发布清单不一致');
    }

    const objectKey = `sites/${version.site_id}/${version.id}/${path}`;
    const uploaded = await c.env.SITES.put(objectKey, body, {
      httpMetadata: { contentType: manifestFile.mime_type }
    });
    await markFileUploaded(c.env.DB, {
      version_id: version.id,
      path,
      size: manifestFile.size,
      mime_type: manifestFile.mime_type,
      etag: uploaded.etag
    });

    return c.json({ success: true, path, size: manifestFile.size, etag: uploaded.etag });
  } catch (error) {
    return errorResponse(c, error);
  }
});

deploymentRoutes.post('/:versionId/finalize', async (c) => {
  const crossOrigin = assertSameOrigin(c.req.raw);
  if (crossOrigin) return crossOrigin;
  const unauthorized = await requireAdmin(c.req.raw, c.env);
  if (unauthorized) return unauthorized;

  try {
    const versionId = c.req.param('versionId');
    const version = await getVersionById(c.env.DB, versionId);
    if (!version) throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
    const site = await getSiteById(c.env.DB, version.site_id);
    if (!site) throw new DeploymentError('SITE_NOT_FOUND', '站点不存在');

    const body = await readJson<{ entryPath?: unknown }>(c.req.raw)
      .catch(() => ({} as { entryPath?: unknown }));
    const entryPath = normalizeRelativePath(body.entryPath ?? site.entry_path);
    const entryFile = await getFile(c.env.DB, versionId, entryPath);
    if (!entryFile) throw new DeploymentError('ENTRY_NOT_IN_MANIFEST', '入口文件不在发布清单中');
    if (entryFile.uploaded_at === null) throw new DeploymentError('ENTRY_NOT_UPLOADED', '入口文件尚未上传');

    await finalizeVersion(c.env.DB, site.id, versionId, entryPath);
    return c.json({
      success: true,
      siteId: site.id,
      slug: site.slug,
      versionId,
      entryPath,
      previewUrl: sitePreviewUrl(site.id, c.env)
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});
