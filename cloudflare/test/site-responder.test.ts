import { env, SELF } from 'cloudflare:test';
import type { Env } from '../src/env';
import {
  createSite,
  createVersion,
  finalizeVersion,
  recordFile
} from '../src/repositories/sites';

const testEnv = env as unknown as Env;

async function seedSite(input: {
  id: string;
  slug: string;
  entryPath: string;
  files: Array<{ path: string; body: string; mimeType: string }>;
}) {
  const versionId = `${input.id}-version`;
  await createSite(testEnv.DB, {
    id: input.id,
    slug: input.slug,
    name: input.slug,
    entry_path: input.entryPath
  });
  const preparedFiles = input.files.map((file) => ({
    ...file,
    bytes: new TextEncoder().encode(file.body)
  }));
  await createVersion(testEnv.DB, {
    id: versionId,
    site_id: input.id,
    file_count: preparedFiles.length,
    total_bytes: preparedFiles.reduce((total, file) => total + file.bytes.byteLength, 0)
  });
  for (const file of preparedFiles) {
    const object = await testEnv.SITES.put(
      `sites/${input.id}/${versionId}/${file.path}`,
      file.bytes.buffer,
      { httpMetadata: { contentType: file.mimeType } }
    );
    await recordFile(testEnv.DB, {
      version_id: versionId,
      path: file.path,
      size: file.bytes.byteLength,
      mime_type: file.mimeType,
      etag: object.etag
    });
  }
  await finalizeVersion(testEnv.DB, input.id, versionId, input.entryPath);
}

describe('R2 site responder', () => {
  it('serves a mapped subdomain with immutable assets and protects the API', async () => {
    await seedSite({
      id: 'site-assets',
      slug: 'assets-site',
      entryPath: 'index.html',
      files: [
        { path: 'index.html', body: '<h1>hello</h1>', mimeType: 'text/html; charset=utf-8' },
        { path: 'app.js', body: 'console.log(1);', mimeType: 'text/javascript; charset=utf-8' }
      ]
    });

    const html = await SELF.fetch('https://assets-site.sites.example.com/');
    expect(html.status).toBe(200);
    await expect(html.text()).resolves.toBe('<h1>hello</h1>');
    expect(html.headers.get('Cache-Control')).toBe('no-cache');
    expect(html.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const asset = await SELF.fetch('https://assets-site.sites.example.com/app.js', { method: 'HEAD' });
    expect(asset.status).toBe(200);
    expect(asset.headers.get('Cache-Control')).toContain('immutable');
    expect(asset.headers.get('Content-Length')).toBe('15');

    const api = await SELF.fetch('https://assets-site.sites.example.com/api/health');
    expect(api.status).toBe(404);
  });

  it('redirects nested entry paths and isolates path previews with CSP sandbox', async () => {
    await seedSite({
      id: 'site-nested',
      slug: 'nested-site',
      entryPath: 'docs/index.html',
      files: [
        { path: 'docs/index.html', body: '<h1>nested</h1>', mimeType: 'text/html; charset=utf-8' },
        { path: 'docs/app.js', body: 'alert(1);', mimeType: 'text/javascript; charset=utf-8' }
      ]
    });

    const trailingSlash = await SELF.fetch(
      'https://quickshare.test/s/site-nested?from=wechat',
      { redirect: 'manual' }
    );
    expect(trailingSlash.status).toBe(308);
    expect(trailingSlash.headers.get('Location')).toBe(
      'https://quickshare.test/s/site-nested/?from=wechat'
    );

    const redirect = await SELF.fetch('https://nested-site.sites.example.com/', { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Location')).toBe('https://nested-site.sites.example.com/docs/index.html');

    const preview = await SELF.fetch('https://quickshare.test/s/site-nested/docs/index.html');
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Content-Security-Policy')).toBe('sandbox allow-scripts');
    await expect(preview.text()).resolves.toBe('<h1>nested</h1>');

    const siteHostPreview = await SELF.fetch('https://nested-site.sites.example.com/s/site-nested/docs/index.html');
    expect(siteHostPreview.status).toBe(404);
  });

  it('does not expose an unknown wildcard hostname', async () => {
    const response = await SELF.fetch('https://missing.sites.example.com/');
    expect(response.status).toBe(404);
  });
});
