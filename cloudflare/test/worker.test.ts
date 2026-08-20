import { SELF } from 'cloudflare:test';

describe('QuickShare Cloudflare worker', () => {
  it('reports a healthy deployment', async () => {
    const response = await SELF.fetch('https://quickshare.test/api/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'quickshare-cloudflare'
    });
  });

  it('serves the static console shell', async () => {
    const response = await SELF.fetch('https://quickshare.test/');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('QuickShare Cloudflare');
  });
});
