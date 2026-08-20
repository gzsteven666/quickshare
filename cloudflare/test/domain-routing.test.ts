import { env, SELF } from 'cloudflare:test';
import type { Env } from '../src/env';
import {
  createSite,
  createVersion,
  finalizeVersion,
  recordFile
} from '../src/repositories/sites';

const testEnv = env as unknown as Env;

describe('custom domain routing', () => {
  it('serves a site through a hostname recorded in D1', async () => {
    const siteId = 'site-custom';
    const versionId = 'site-custom-version';
    const body = '<p>custom</p>';
    await createSite(testEnv.DB, {
      id: siteId,
      slug: 'custom-site',
      name: 'Custom site',
      entry_path: 'index.html'
    });
    await createVersion(testEnv.DB, {
      id: versionId,
      site_id: siteId,
      file_count: 1,
      total_bytes: new TextEncoder().encode(body).byteLength
    });
    const object = await testEnv.SITES.put(
      `sites/${siteId}/${versionId}/index.html`,
      body,
      { httpMetadata: { contentType: 'text/html; charset=utf-8' } }
    );
    await recordFile(testEnv.DB, {
      version_id: versionId,
      path: 'index.html',
      size: new TextEncoder().encode(body).byteLength,
      mime_type: 'text/html; charset=utf-8',
      etag: object.etag
    });
    await finalizeVersion(testEnv.DB, siteId, versionId, 'index.html');
    await testEnv.DB.prepare(
      'INSERT INTO domains (hostname, site_id, created_at) VALUES (?, ?, ?)'
    ).bind('custom.example.com', siteId, Date.now()).run();

    const response = await SELF.fetch('https://custom.example.com/');
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(body);
  });
});
