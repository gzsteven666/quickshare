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

export interface SiteSummary extends SiteRecord {
  version_count: number;
  current_status: VersionRecord['status'] | null;
  current_file_count: number;
  current_total_bytes: number;
  domain_count: number;
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
  uploaded_at: number | null;
}

export interface ManifestFileInput {
  path: string;
  size: number;
  mime_type: string;
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

export async function getSiteByHostname(db: D1Database, hostname: string): Promise<SiteRecord | null> {
  return db.prepare(
    `SELECT sites.* FROM sites
     INNER JOIN domains ON domains.site_id = sites.id
     WHERE domains.hostname = ?`
  ).bind(hostname).first<SiteRecord>();
}

export async function listSiteSummaries(db: D1Database): Promise<SiteSummary[]> {
  const result = await db.prepare(
    `SELECT sites.*,
       COUNT(DISTINCT versions.id) AS version_count,
       current_version.status AS current_status,
       COALESCE(current_version.file_count, 0) AS current_file_count,
       COALESCE(current_version.total_bytes, 0) AS current_total_bytes,
       COUNT(DISTINCT domains.hostname) AS domain_count
     FROM sites
     LEFT JOIN versions ON versions.site_id = sites.id
     LEFT JOIN versions AS current_version ON current_version.id = sites.current_version_id
     LEFT JOIN domains ON domains.site_id = sites.id
     GROUP BY sites.id
     ORDER BY sites.updated_at DESC`
  ).all<SiteSummary>();
  return result.results;
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
  input: Omit<FileRecord, 'etag' | 'uploaded_at'> & { etag?: string | null }
): Promise<void> {
  const version = await getVersionById(db, input.version_id);
  if (!version) throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
  if (version.status !== 'uploading') {
    throw new DeploymentError('VERSION_NOT_UPLOADING', '发布版本已经结束上传');
  }

  await db.prepare(
    `INSERT INTO files (version_id, path, size, mime_type, etag, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    input.version_id,
    input.path,
    input.size,
    input.mime_type,
    input.etag ?? null,
    Date.now()
  ).run();
}

export async function recordManifest(
  db: D1Database,
  versionId: string,
  files: ManifestFileInput[]
): Promise<void> {
  const version = await getVersionById(db, versionId);
  if (!version) throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
  if (version.status !== 'uploading') {
    throw new DeploymentError('VERSION_NOT_UPLOADING', '发布版本已经结束上传');
  }

  await db.batch(files.map((file) => db.prepare(
    `INSERT INTO files (version_id, path, size, mime_type, etag, uploaded_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`
  ).bind(versionId, file.path, file.size, file.mime_type)));
}

export async function markFileUploaded(
  db: D1Database,
  input: Pick<FileRecord, 'version_id' | 'path' | 'size' | 'mime_type'> & { etag?: string | null },
  now = Date.now()
): Promise<void> {
  const version = await getVersionById(db, input.version_id);
  if (!version) throw new DeploymentError('VERSION_NOT_FOUND', '发布版本不存在');
  if (version.status !== 'uploading') {
    throw new DeploymentError('VERSION_NOT_UPLOADING', '发布版本已经结束上传');
  }

  const manifestFile = await getFile(db, input.version_id, input.path);
  if (!manifestFile) {
    throw new DeploymentError('FILE_NOT_IN_MANIFEST', '文件不在发布清单中');
  }
  if (manifestFile.uploaded_at !== null) {
    throw new DeploymentError('FILE_ALREADY_UPLOADED', '文件已经上传');
  }
  if (manifestFile.size !== input.size || manifestFile.mime_type !== input.mime_type) {
    throw new DeploymentError('FILE_METADATA_MISMATCH', '文件大小或类型与发布清单不一致');
  }

  await db.prepare(
    `UPDATE files SET etag = ?, uploaded_at = ?
     WHERE version_id = ? AND path = ? AND uploaded_at IS NULL`
  ).bind(input.etag ?? null, now, input.version_id, input.path).run();
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
     FROM files WHERE version_id = ? AND uploaded_at IS NOT NULL`
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

export async function deleteSiteRecords(db: D1Database, siteId: string): Promise<boolean> {
  const site = await getSiteById(db, siteId);
  if (!site) return false;

  await db.batch([
    db.prepare(
      `DELETE FROM files
       WHERE version_id IN (SELECT id FROM versions WHERE site_id = ?)`
    ).bind(siteId),
    db.prepare('DELETE FROM versions WHERE site_id = ?').bind(siteId),
    db.prepare('DELETE FROM domains WHERE site_id = ?').bind(siteId),
    db.prepare('DELETE FROM sites WHERE id = ?').bind(siteId)
  ]);
  return true;
}
