import { env, SELF } from 'cloudflare:test';
import type { Env } from '../src/env';
import { createSite } from '../src/repositories/sites';

const testEnv = env as unknown as Env;

async function adminCookie(): Promise<string> {
  const response = await SELF.fetch('https://quickshare.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password' })
  });
  return response.headers.get('Set-Cookie')?.split(';')[0] || '';
}

describe('domain mapping API', () => {
  it('normalizes a hostname and returns manual Cloudflare binding instructions', async () => {
    await createSite(testEnv.DB, {
      id: 'domain-site',
      slug: 'domain-site',
      name: 'Domain site',
      entry_path: 'index.html'
    });
    const cookie = await adminCookie();
    const response = await SELF.fetch('https://quickshare.test/api/domains', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: 'domain-site', hostname: 'WWW.Example.com.' })
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      domain: { hostname: 'www.example.com', site_id: 'domain-site' },
      instructions: { mode: 'custom-domain' }
    });

    const list = await SELF.fetch('https://quickshare.test/api/domains?siteId=domain-site', {
      headers: { Cookie: cookie }
    });
    await expect(list.json()).resolves.toMatchObject({
      success: true,
      domains: [{ hostname: 'www.example.com' }]
    });
  });

  it('rejects conflicts and allows removing a mapping', async () => {
    await createSite(testEnv.DB, {
      id: 'domain-site-a',
      slug: 'domain-site-a',
      name: 'Site A',
      entry_path: 'index.html'
    });
    await createSite(testEnv.DB, {
      id: 'domain-site-b',
      slug: 'domain-site-b',
      name: 'Site B',
      entry_path: 'index.html'
    });
    const cookie = await adminCookie();
    const create = (siteId: string) => SELF.fetch('https://quickshare.test/api/domains', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, hostname: 'mapped.example.com' })
    });
    expect((await create('domain-site-a')).status).toBe(201);
    const conflict = await create('domain-site-b');
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'DOMAIN_IN_USE' });

    const deleted = await SELF.fetch(
      'https://quickshare.test/api/domains/mapped.example.com?siteId=domain-site-a',
      { method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://quickshare.test' } }
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ success: true, deleted: true });
  });

  it('rejects protocols, ports, and malformed hostnames', async () => {
    const cookie = await adminCookie();
    const response = await SELF.fetch('https://quickshare.test/api/domains', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: 'missing', hostname: 'https://bad.example.com:443' })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_HOSTNAME' });
  });
});
