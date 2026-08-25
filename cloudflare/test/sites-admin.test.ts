import { env, SELF } from 'cloudflare:test';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { Env } from '../src/env';
import {
  createSite,
  createVersion,
  finalizeVersion,
  getSiteById,
  recordFile
} from '../src/repositories/sites';

const testEnv = env as unknown as Env;

async function adminCookie(): Promise<string> {
  const response = await SELF.fetch('https://quickshare.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password' })
  });
  expect(response.status).toBe(200);
  return response.headers.get('Set-Cookie')?.split(';')[0] || '';
}

describe('site management API', () => {
  it('lists deployed sites and deletes all D1/R2 records for a site', async () => {
    const siteId = 'managed-site';
    const versionId = 'managed-version';
    const body = '<h1>managed</h1>';
    await createSite(testEnv.DB, {
      id: siteId,
      slug: 'managed-site',
      name: 'Managed site',
      entry_path: 'index.html'
    });
    await createVersion(testEnv.DB, {
      id: versionId,
      site_id: siteId,
      file_count: 1,
      total_bytes: new TextEncoder().encode(body).byteLength
    });
    const objectKey = `sites/${siteId}/${versionId}/index.html`;
    const object = await testEnv.SITES.put(objectKey, body, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' }
    });
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
    ).bind('managed.example.com', siteId, Date.now()).run();

    const cookie = await adminCookie();
    const list = await SELF.fetch('https://quickshare.test/api/sites', {
      headers: { Cookie: cookie }
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      success: true,
      sites: [{
        siteId,
        slug: 'managed-site',
        currentStatus: 'ready',
        currentFileCount: 1,
        versionCount: 1,
        domains: ['managed.example.com']
      }]
    });

    const exported = await SELF.fetch(`https://quickshare.test/api/sites/${siteId}/export`, {
      headers: { Cookie: cookie }
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('Content-Type')).toBe('application/zip');
    expect(exported.headers.get('Content-Disposition')).toBe('attachment; filename="managed-site.zip"');
    const archive = new ZipReader(new BlobReader(await exported.blob()));
    const entries = await archive.getEntries();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    if (entry.directory) throw new Error('导出包不应包含目录条目');
    await expect(entry.getData(new TextWriter())).resolves.toBe(body);
    await archive.close();

    const deleted = await SELF.fetch(`https://quickshare.test/api/sites/${siteId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://quickshare.test' }
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      success: true,
      siteId,
      deletedObjects: 1
    });
    expect(await getSiteById(testEnv.DB, siteId)).toBeNull();
    expect(await testEnv.DB.prepare('SELECT * FROM versions WHERE site_id = ?').bind(siteId).all()).toMatchObject({ results: [] });
    expect(await testEnv.DB.prepare('SELECT * FROM files WHERE version_id = ?').bind(versionId).all()).toMatchObject({ results: [] });
    expect(await testEnv.DB.prepare('SELECT * FROM domains WHERE site_id = ?').bind(siteId).all()).toMatchObject({ results: [] });
    expect((await testEnv.SITES.list({ prefix: `sites/${siteId}/` })).objects).toHaveLength(0);
  });

  it('does not allow an unauthenticated deletion', async () => {
    const response = await SELF.fetch('https://quickshare.test/api/sites/missing-site', {
      method: 'DELETE',
      headers: { Origin: 'https://quickshare.test' }
    });
    expect(response.status).toBe(401);

    const exportResponse = await SELF.fetch('https://quickshare.test/api/sites/missing-site/export');
    expect(exportResponse.status).toBe(401);
  });
});
