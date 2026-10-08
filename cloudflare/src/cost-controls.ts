import type { Env } from './env';
import { DeploymentError } from './errors';

export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const MAX_VERSIONS_PER_SITE = 20;

export function positiveLimit(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

// UPDATE is atomic across requests. Exhausted or unavailable budgets never allow R2 work.
export async function claimOperations(db: D1Database, kind: 'writes' | 'export_reads', count = 1): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const result = await db.prepare(`
    UPDATE operation_budgets SET
      writes = CASE WHEN day = ? THEN writes ELSE 0 END + ?,
      export_reads = CASE WHEN day = ? THEN export_reads ELSE 0 END + ?, day = ?
    WHERE resource = 'quickshare'
      AND (CASE WHEN day = ? THEN ${kind} ELSE 0 END) + ? <= 2000
  `).bind(day, kind === 'writes' ? count : 0, day, kind === 'export_reads' ? count : 0, day, day, count).run();
  if (result.meta.changes !== 1) {
    throw new DeploymentError('DAILY_OPERATION_LIMIT', '今日存储操作额度已用完，请明天再试。');
  }
}

export async function rateLimit(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const binding = path === '/api/auth/login' ? env.LOGIN_RATE_LIMIT
    : path.startsWith('/api/') && request.method !== 'GET' ? env.WRITE_RATE_LIMIT
    : env.READ_RATE_LIMIT;
  if (!binding) return null; // Tests and local development can omit native bindings.
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  if ((await binding.limit({ key })).success) return null;
  return Response.json({ success: false, error: '请求过于频繁，请稍后再试。' }, {
    status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' }
  });
}
