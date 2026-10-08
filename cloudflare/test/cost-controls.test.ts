import { env } from 'cloudflare:test';
import type { Env } from '../src/env';
import { claimOperations, rateLimit } from '../src/cost-controls';
import { createSite, createVersion } from '../src/repositories/sites';

const db = (env as unknown as Env).DB;

describe('cost controls', () => {
  it('atomically reserves total storage under concurrent manifests', async () => {
    await createSite(db, { id: 'quota', slug: 'quota', name: 'Quota', entry_path: 'index.html' });
    const results = await Promise.allSettled([1, 2].map(i => createVersion(db, {
      id: `quota-${i}`, site_id: 'quota', file_count: 1, total_bytes: 60
    }, Date.now(), { maxTotalBytes: 100, maxVersionsPerSite: 20 })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prepare('SELECT SUM(total_bytes) AS bytes FROM versions').first('bytes')).toBe(60);
  });

  it('includes unfinished versions in the version ceiling', async () => {
    await createSite(db, { id: 'versions', slug: 'versions', name: 'Versions', entry_path: 'index.html' });
    const input = { site_id: 'versions', file_count: 1, total_bytes: 1 };
    const limits = { maxTotalBytes: 100, maxVersionsPerSite: 1 };
    await createVersion(db, { ...input, id: 'v1' }, Date.now(), limits);
    await expect(createVersion(db, { ...input, id: 'v2' }, Date.now(), limits)).rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
  });

  it('does not exceed a daily budget concurrently and resets the next UTC day', async () => {
    await claimOperations(db, 'writes', 1999);
    const results = await Promise.allSettled([claimOperations(db, 'writes'), claimOperations(db, 'writes')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(claimOperations(db, 'writes')).rejects.toMatchObject({ code: 'DAILY_OPERATION_LIMIT' });
    await claimOperations(db, 'export_reads', 2000);
    await expect(claimOperations(db, 'export_reads')).rejects.toMatchObject({ code: 'DAILY_OPERATION_LIMIT' });
    await db.prepare("UPDATE operation_budgets SET day = '2000-01-01' WHERE resource = 'quickshare'").run();
    await expect(claimOperations(db, 'writes')).resolves.toBeUndefined();
    expect(await db.prepare("SELECT writes FROM operation_budgets WHERE resource = 'quickshare'").first('writes')).toBe(1);
  });

  it('fails closed when the budget row is missing', async () => {
    await db.prepare("DELETE FROM operation_budgets WHERE resource = 'quickshare'").run();
    await expect(claimOperations(db, 'writes')).rejects.toMatchObject({ code: 'DAILY_OPERATION_LIMIT' });
    await db.prepare("INSERT INTO operation_budgets(resource) VALUES ('quickshare')").run();
  });

  it('uses the login limiter before allowing authentication work', async () => {
    const binding = { limit: vi.fn(async () => ({ success: false })) };
    const response = await rateLimit(new Request('https://test/api/auth/login', {
      method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.1' }
    }), { LOGIN_RATE_LIMIT: binding } as unknown as Env);
    expect(response?.status).toBe(429);
    expect(binding.limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
  });
});
