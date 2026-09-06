import { env, SELF } from 'cloudflare:test';
import type { Env } from '../src/env';
import { getSiteById, getVersionById } from '../src/repositories/sites';

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

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'demo-site',
    name: 'Demo site',
    entryPath: 'index.html',
    files: [
      { path: 'index.html', size: 18, mimeType: 'text/html; charset=utf-8' },
      { path: 'assets/app.js', size: 18, mimeType: 'text/javascript; charset=utf-8' }
    ],
    ...overrides
  };
}

describe('deployment upload API', () => {
  it('rejects unsafe manifests before creating a version', async () => {
    const cookie = await adminCookie();
    const response = await SELF.fetch('https://quickshare.test/api/deployments', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest({
        files: [{ path: '../index.html', size: 1, mimeType: 'text/html' }],
        entryPath: '../index.html'
      }))
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'INVALID_PATH'
    });
  });

  it('creates a server-side manifest and uploads only declared files', async () => {
    const cookie = await adminCookie();
    const create = await SELF.fetch('https://quickshare.test/api/deployments', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest())
    });
    const created = await create.json() as {
      siteId: string;
      versionId: string;
      previewUrl: string;
    };

    expect(create.status).toBe(201);
    expect(created.previewUrl).toBe(`/s/${created.siteId}/`);
    expect((await getVersionById(testEnv.DB, created.versionId))?.status).toBe('uploading');

    const unknownFile = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/files?path=unknown.txt`,
      {
        method: 'PUT',
        headers: { Cookie: cookie },
        body: 'not declared'
      }
    );
    expect(unknownFile.status).toBe(404);
  });

  it('creates a new version for an existing slug without changing its site URL', async () => {
    const cookie = await adminCookie();
    const first = await SELF.fetch('https://quickshare.test/api/deployments', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest({ slug: 'update-site' }))
    });
    const firstDeployment = await first.json() as { siteId: string; versionId: string; previewUrl: string };

    const second = await SELF.fetch('https://quickshare.test/api/deployments', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest({ slug: 'update-site' }))
    });
    const secondDeployment = await second.json() as { siteId: string; versionId: string; previewUrl: string };

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(secondDeployment.siteId).toBe(firstDeployment.siteId);
    expect(secondDeployment.previewUrl).toBe(firstDeployment.previewUrl);
    expect(secondDeployment.versionId).not.toBe(firstDeployment.versionId);
  });

  it('writes R2 objects and atomically publishes a complete version', async () => {
    const cookie = await adminCookie();
    const create = await SELF.fetch('https://quickshare.test/api/deployments', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest({ slug: 'publish-site' }))
    });
    const created = await create.json() as { siteId: string; versionId: string };
    const indexBody = '<html>demo!</html>'; // 18 bytes

    const indexUpload = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/files?path=index.html`,
      {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'text/html; charset=utf-8' },
        body: indexBody
      }
    );
    expect(indexUpload.status).toBe(200);

    const incomplete = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/finalize`,
      { method: 'POST', headers: { Cookie: cookie } }
    );
    expect(incomplete.status).toBe(400);
    await expect(incomplete.json()).resolves.toMatchObject({ code: 'INCOMPLETE_VERSION' });
    expect((await getSiteById(testEnv.DB, created.siteId))?.current_version_id).toBeNull();

    const scriptUpload = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/files?path=assets/app.js`,
      {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'text/javascript; charset=utf-8' },
        body: 'console.log(123);'
      }
    );
    expect(scriptUpload.status).toBe(400);

    const validScript = 'console.log(1);';
    expect(new TextEncoder().encode(validScript).byteLength).toBe(15);
    const retryScript = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/files?path=assets/app.js`,
      {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'text/javascript; charset=utf-8' },
        body: validScript + '   '
      }
    );
    expect(retryScript.status).toBe(200);

    const duplicate = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/files?path=assets/app.js`,
      {
        method: 'PUT',
        headers: { Cookie: cookie },
        body: validScript + '   '
      }
    );
    expect(duplicate.status).toBe(409);

    const finalize = await SELF.fetch(
      `https://quickshare.test/api/deployments/${created.versionId}/finalize`,
      { method: 'POST', headers: { Cookie: cookie } }
    );
    expect(finalize.status).toBe(200);
    await expect(finalize.json()).resolves.toMatchObject({
      success: true,
      siteId: created.siteId,
      versionId: created.versionId,
      entryPath: 'index.html'
    });

    expect((await getSiteById(testEnv.DB, created.siteId))?.current_version_id).toBe(created.versionId);
    expect((await getVersionById(testEnv.DB, created.versionId))?.status).toBe('ready');
    const stored = await testEnv.SITES.get(`sites/${created.siteId}/${created.versionId}/index.html`);
    await expect(stored?.text()).resolves.toBe(indexBody);
  });
});
