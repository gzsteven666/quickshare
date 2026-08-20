import { DeploymentError } from '../errors';

export interface SiteRecord {
  id: string;
  slug: string;
  name: string;
  entry_path: string;
  current_version_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface VersionRecord {
  id: string;
  site_id: string;
  status: 'uploading' | 'ready' | 'failed';
  file_count: number;
  total_bytes: number;
  created_at: number;
  published_at: number | null;
}

export interface FileRecord {
  version_id: string;
  path: string;
  size: number;
  mime_type: string;
  etag: string | null;
}

export async function createSite(
  db: D1Database,
  input: Pick<SiteRecord, 'id' | 'slug' | 'name' | 'entry_path'>,
  now = Date.now()
): Promise<void> {
  await db.prepare(
    `INSERT INTO sites (id, slug, name, entry_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(input.id, input.slug, input.name, input.entry_path, now, now).run();
}

export async function createVersion(
  db: D1Database,
  input: Pick<VersionRecord, 'id' | 'site_id' | 'file_count' | 'total_bytes'>,
  now = Date.now()
): Promise<void> {
  await db.prepare(
    `INSERT INTO versions (id, site_id, status, file_count, total_bytes, created_at)
     VALUES (?, ?, 'uploading', ?, ?, ?)`
  ).bind(input.id, input.site_id, input.file_count, input.total_bytes, now).run();
}

export async function getSiteById(db: D1Database, siteId: string): Promise<SiteRecord | null> {
  return db.prepare('SELECT * FROM sites WHERE id = ?').bind(siteId).first<SiteRecord>();
}

export async function getSiteBySlug(db: D1Database, slug: string): Promise<SiteRecord | null> {
  return db.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first<SiteRecord>();
}

export async function getVersionById(db: D1Database, versionId: string): Promise<VersionRecord | null> {
  return db.prepare('SELECT * FROM versions WHERE id = ?').bind(versionId).first<VersionRecord>();
}

export async function getFile(
  db: D1Database,
  versionId: string,
  filePath: string
): Promise<FileRecord | null> {
  return db.prepare(
    'SELECT * FROM files WHERE version_id = ? AND path = ?'
  ).bind(versionId, filePath).first<FileRecord>();
}

export async function recordFile(
  db: D1Database,
  input: Omit<FileRecord, 'etag'> & { etag?: string | null }
): Promise<void> {
  const version = await getVersionById(db, input.version_id);
  if (!version) throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
  if (version.status !== 'uploading') {
    throw new DeploymentError('VERSION_NOT_UPLOADING', '发布版本已经结束上传');
  }

  await db.prepare(
    `INSERT INTO files (version_id, path, size, mime_type, etag)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(input.version_id, input.path, input.size, input.mime_type, input.etag ?? null).run();
}

export async function finalizeVersion(
  db: D1Database,
  siteId: string,
  versionId: string,
  entryPath: string,
  now = Date.now()
): Promise<void> {
  const version = await getVersionById(db, versionId);
  if (!version || version.site_id !== siteId) {
    throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
  }
  if (version.status !== 'uploading') {
    throw new DeploymentError('VERSION_NOT_UPLOADING', '发布版本已经结束上传');
  }

  const aggregate = await db.prepare(
    `SELECT COUNT(*) AS file_count, COALESCE(SUM(size), 0) AS total_bytes
     FROM files WHERE version_id = ?`
  ).bind(versionId).first<{ file_count: number; total_bytes: number }>();

  if (!aggregate || aggregate.file_count !== version.file_count || aggregate.total_bytes !== version.total_bytes) {
    throw new DeploymentError('INCOMPLETE_VERSION', '发布版本文件尚未全部上传');
  }

  await db.batch([
    db.prepare(
      `UPDATE versions SET status = 'ready', published_at = ?
       WHERE id = ? AND site_id = ? AND status = 'uploading'`
    ).bind(now, versionId, siteId),
    db.prepare(
      `UPDATE sites SET current_version_id = ?, entry_path = ?, updated_at = ?
       WHERE id = ?`
    ).bind(versionId, entryPath, now, siteId)
  ]);
}
