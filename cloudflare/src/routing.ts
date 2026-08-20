import type { Env } from './env';
import { getSiteByHostname, getSiteBySlug } from './repositories/sites';
import type { SiteRecord } from './repositories/sites';

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '').split(':')[0];
}

export function requestHostname(request: Request): string {
  const host = request.headers.get('Host') || new URL(request.url).hostname;
  return normalizeHost(host);
}

function configuredHost(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeHost(value);
  return normalized || null;
}

export function isBaseDomainSiteHost(hostname: string, env: Pick<Env, 'SITES_BASE_DOMAIN'>): boolean {
  const base = configuredHost(env.SITES_BASE_DOMAIN);
  if (!base) return false;
  return hostname.endsWith(`.${base}`) && hostname.length > base.length + 1;
}

export async function resolveSiteByHost(
  db: D1Database,
  hostname: string,
  env: Pick<Env, 'SITES_BASE_DOMAIN'>
): Promise<SiteRecord | null> {
  const base = configuredHost(env.SITES_BASE_DOMAIN);
  if (base && hostname.endsWith(`.${base}`)) {
    const slug = hostname.slice(0, -(base.length + 1));
    if (!slug || slug.includes('.')) return null;
    return getSiteBySlug(db, slug);
  }
  return getSiteByHostname(db, hostname);
}

export async function isSiteRequestHost(
  db: D1Database,
  request: Request,
  env: Pick<Env, 'APP_HOST' | 'SITES_BASE_DOMAIN'>
): Promise<boolean> {
  const hostname = requestHostname(request);
  const appHost = configuredHost(env.APP_HOST);
  if (appHost && hostname !== appHost) return true;
  if (isBaseDomainSiteHost(hostname, env)) return true;
  return Boolean(await getSiteByHostname(db, hostname));
}

export function isManagementHost(
  request: Request,
  env: Pick<Env, 'APP_HOST' | 'SITES_BASE_DOMAIN'>
): boolean {
  const hostname = requestHostname(request);
  const appHost = configuredHost(env.APP_HOST);
  if (appHost) return hostname === appHost;
  return !isBaseDomainSiteHost(hostname, env);
}
