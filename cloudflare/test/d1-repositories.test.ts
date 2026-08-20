import { env } from 'cloudflare:test';
import { DeploymentError } from '../src/errors';
import type { Env } from '../src/env';
import {
  createSite,
  createVersion,
  finalizeVersion,
  getSiteById,
  recordFile
} from '../src/repositories/sites';

const testEnv = env as unknown as Env;

describe('D1 site and version repositories', () => {
  it('keeps an uploading version invisible until finalize', async () => {
    await createSite(testEnv.DB, {
      id: 'site-1',
      slug: 'site-1',
      name: 'Site one',
      entry_path: 'index.html'
    });
    await createVersion(testEnv.DB, {
      id: 'version-1',
      site_id: 'site-1',
      file_count: 1,
      total_bytes: 5
    });
    await recordFile(testEnv.DB, {
      version_id: 'version-1',
      path: 'index.html',
      size: 5,
      mime_type: 'text/html; charset=utf-8'
    });

    const site = await getSiteById(testEnv.DB, 'site-1');
    expect(site?.current_version_id).toBeNull();

    await finalizeVersion(testEnv.DB, 'site-1', 'version-1', 'index.html');

    const published = await getSiteById(testEnv.DB, 'site-1');
    expect(published?.current_version_id).toBe('version-1');
  });

  it('rejects incomplete versions without changing the current version', async () => {
    await createSite(testEnv.DB, {
      id: 'site-2',
      slug: 'site-2',
      name: 'Site two',
      entry_path: 'index.html'
    });
    await createVersion(testEnv.DB, {
      id: 'version-2',
      site_id: 'site-2',
      file_count: 2,
      total_bytes: 10
    });
    await recordFile(testEnv.DB, {
      version_id: 'version-2',
      path: 'index.html',
      size: 5,
      mime_type: 'text/html; charset=utf-8'
    });

    await expect(finalizeVersion(testEnv.DB, 'site-2', 'version-2', 'index.html'))
      .rejects.toMatchObject({ code: 'INCOMPLETE_VERSION' });
    expect((await getSiteById(testEnv.DB, 'site-2'))?.current_version_id).toBeNull();
  });

  it('does not accept files after a version is published', async () => {
    await createSite(testEnv.DB, {
      id: 'site-3',
      slug: 'site-3',
      name: 'Site three',
      entry_path: 'index.html'
    });
    await createVersion(testEnv.DB, {
      id: 'version-3',
      site_id: 'site-3',
      file_count: 1,
      total_bytes: 1
    });
    await recordFile(testEnv.DB, {
      version_id: 'version-3',
      path: 'index.html',
      size: 1,
      mime_type: 'text/html; charset=utf-8'
    });
    await finalizeVersion(testEnv.DB, 'site-3', 'version-3', 'index.html');

    await expect(recordFile(testEnv.DB, {
      version_id: 'version-3',
      path: 'late.js',
      size: 1,
      mime_type: 'text/javascript; charset=utf-8'
    })).rejects.toBeInstanceOf(DeploymentError);
  });
});
