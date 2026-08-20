import { DeploymentError } from './errors';
import { getSiteById } from './repositories/sites';

export interface DomainRecord {
  hostname: string;
  site_id: string;
  created_at: number;
}

export function normalizeDomainHostname(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DeploymentError('INVALID_HOSTNAME', '域名必须是字符串');
  }
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253 || hostname.includes('/') || hostname.includes(':') || hostname.includes('://')) {
    throw new DeploymentError('INVALID_HOSTNAME', '请输入不带协议和端口的域名');
  }
  const labels = hostname.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new DeploymentError('INVALID_HOSTNAME', '域名格式无效');
  }
  return hostname;
}

export async function listDomains(db: D1Database, siteId: string): Promise<DomainRecord[]> {
  const result = await db.prepare(
    `SELECT hostname, site_id, created_at FROM domains
     WHERE site_id = ? ORDER BY hostname ASC`
  ).bind(siteId).all<DomainRecord>();
  return result.results;
}

export async function createDomainMapping(
  db: D1Database,
  siteId: string,
  hostname: string,
  now = Date.now()
): Promise<DomainRecord> {
  if (!await getSiteById(db, siteId)) {
    throw new DeploymentError('SITE_NOT_FOUND', '站点不存在');
  }
  const existing = await db.prepare(
    'SELECT hostname, site_id, created_at FROM domains WHERE hostname = ?'
  ).bind(hostname).first<DomainRecord>();
  if (existing) {
    if (existing.site_id !== siteId) {
      throw new DeploymentError('DOMAIN_IN_USE', '该域名已经映射到其他站点');
    }
    return existing;
  }
  await db.prepare(
    'INSERT INTO domains (hostname, site_id, created_at) VALUES (?, ?, ?)'
  ).bind(hostname, siteId, now).run();
  return { hostname, site_id: siteId, created_at: now };
}

export async function deleteDomainMapping(db: D1Database, hostname: string, siteId: string): Promise<boolean> {
  const result = await db.prepare(
    'DELETE FROM domains WHERE hostname = ? AND site_id = ?'
  ).bind(hostname, siteId).run();
  return result.meta.changes > 0;
}
