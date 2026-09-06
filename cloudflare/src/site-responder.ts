import type { Env } from './env';
import { getFile, getVersionById } from './repositories/sites';
import type { SiteRecord } from './repositories/sites';
import { normalizeRelativePath } from './validation';

export interface SiteResponseOptions {
  preview?: boolean;
}

function pathPrefix(env: Env): string {
  return (env.SITE_PATH_PREFIX || '/s').replace(/\/$/, '');
}

function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function requestRelativePath(pathname: string, siteId: string, env: Env, preview: boolean): string | null {
  if (!preview) {
    if (pathname === '/' || pathname === '') return null;
    return pathname.startsWith('/') ? pathname.slice(1) : pathname;
  }

  const prefix = `${pathPrefix(env)}/${encodeURIComponent(siteId)}`;
  if (pathname === prefix || pathname === `${prefix}/`) return null;
  if (!pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length + 1);
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

function isHumanAtlasFile(filePath: string): boolean {
  return filePath === 'public/human-atlas/index.html' || filePath.startsWith('public/human-atlas/');
}

export async function serveSite(
  request: Request,
  env: Env,
  site: SiteRecord,
  options: SiteResponseOptions = {}
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' }
    });
  }

  const versionId = site.current_version_id;
  if (!versionId) return notFound();
  const version = await getVersionById(env.DB, versionId);
  if (!version || version.status !== 'ready') return notFound();

  const url = new URL(request.url);
  const relativePath = requestRelativePath(url.pathname, site.id, env, options.preview === true);
  if (relativePath === null && !url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
    return Response.redirect(url, 308);
  }

  let filePath: string;
  try {
    filePath = relativePath === null ? normalizeRelativePath(site.entry_path) : normalizeRelativePath(decodeURIComponent(relativePath));
  } catch {
    return notFound();
  }

  const isRootRequest = relativePath === null;
  const prefix = options.preview ? `${pathPrefix(env)}/${encodeURIComponent(site.id)}/` : '/';
  if (isRootRequest && filePath !== 'index.html') {
    const location = new URL(`${prefix}${encodePath(filePath)}`, request.url);
    return Response.redirect(location, 302);
  }

  const file = await getFile(env.DB, versionId, filePath);
  if (!file || file.uploaded_at === null) return notFound();

  const objectKey = `sites/${site.id}/${versionId}/${filePath}`;
  const object = await env.SITES.get(objectKey);
  if (!object) return notFound();

  const headers = new Headers();
  headers.set('Content-Type', file.mime_type || object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  if (file.etag || object.etag) headers.set('ETag', file.etag || object.etag);
  if (object.size !== undefined) headers.set('Content-Length', String(object.size));

  if (file.mime_type.toLowerCase().startsWith('text/html')) {
    headers.set('Cache-Control', 'no-cache');
  } else {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  if (options.preview) {
    headers.set('Content-Security-Policy', 'sandbox allow-scripts');
    // Preview pages have an opaque origin because of the sandbox. Human Atlas loads
    // module, stylesheet, and model files from its own shared directory, so those
    // responses need explicit CORS permission while the sandbox remains intact.
    if (isHumanAtlasFile(filePath)) {
      headers.set('Access-Control-Allow-Origin', '*');
    }
  }

  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers
  });
}
