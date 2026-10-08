import { SELF } from 'cloudflare:test';
// @ts-expect-error browser module has no generated declarations.
import { buildHtmlManifest } from '../public/app-core.js';

describe('pasted HTML deployment', () => {
  it('rejects empty input and enforces UTF-8 byte limits', () => {
    expect(() => buildHtmlManifest('  \n')).toThrow('粘贴');
    expect(() => buildHtmlManifest('中文', { maxFileBytes: 5, maxSiteBytes: 100 })).toThrow('大小');
  });

  it('uploads and serves pasted HTML without ZIP processing', async () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>你好，世界</h1></body></html>';
    const manifest = buildHtmlManifest(html);
    expect(manifest.totalBytes).toBe(new TextEncoder().encode(html).length);
    const login = await SELF.fetch('https://quickshare.test/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' })
    });
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const create = await SELF.fetch('https://quickshare.test/api/deployments', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'HTML 页面', slug: 'pasted-html', entryPath: manifest.entryPath,
        files: manifest.files.map(({ path, size, mimeType }: { path: string; size: number; mimeType: string }) => ({ path, size, mimeType })) })
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { versionId: string; previewUrl: string };
    const upload = await SELF.fetch(`https://quickshare.test/api/deployments/${created.versionId}/files?path=index.html`, {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': manifest.files[0].mimeType }, body: manifest.files[0].blob
    });
    expect(upload.status).toBe(200);
    const publish = await SELF.fetch(`https://quickshare.test/api/deployments/${created.versionId}/finalize`, {
      method: 'POST', headers, body: JSON.stringify({ entryPath: 'index.html' })
    });
    expect(publish.status).toBe(200);
    const page = await SELF.fetch(`https://quickshare.test${created.previewUrl}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(await page.text()).toContain('你好，世界');
  });
});
