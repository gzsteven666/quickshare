import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env } from '../src/env';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.DB.batch([
    testEnv.DB.prepare('DELETE FROM files'),
    testEnv.DB.prepare('DELETE FROM versions'),
    testEnv.DB.prepare('DELETE FROM domains'),
    testEnv.DB.prepare('DELETE FROM sites'),
    testEnv.DB.prepare("UPDATE operation_budgets SET reserved_bytes = 0, day = '', writes = 0, export_reads = 0")
  ]);
});
