import { DeploymentError } from './errors';
import type { Env } from './env';
import type { ManifestFileInput } from './repositories/sites';

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SITE_BYTES = 30 * 1024 * 1024;
const MAX_PATH_LENGTH = 1024;
const MAX_SLUG_LENGTH = 63;
const MAX_NAME_LENGTH = 120;

export interface DeploymentManifestInput {
  slug?: unknown;
  name?: unknown;
  entryPath?: unknown;
  files?: unknown;
}

export interface ValidatedManifest {
  slug: string;
  name: string;
  entryPath: string;
  files: ManifestFileInput[];
  totalBytes: number;
}

function numericLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function deploymentLimits(env: Pick<Env, 'MAX_FILES' | 'MAX_FILE_BYTES' | 'MAX_SITE_BYTES'>) {
  return {
    maxFiles: numericLimit(env.MAX_FILES, DEFAULT_MAX_FILES),
    maxFileBytes: numericLimit(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
    maxSiteBytes: numericLimit(env.MAX_SITE_BYTES, DEFAULT_MAX_SITE_BYTES)
  };
}

export function normalizeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DeploymentError('INVALID_PATH', '文件路径不能为空');
  }
  if (value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    throw new DeploymentError('INVALID_PATH', '文件路径无效');
  }
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new DeploymentError('INVALID_PATH', '文件路径必须是相对路径');
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new DeploymentError('INVALID_PATH', '文件路径包含非法目录段');
  }
  return segments.join('/');
}

export function normalizeSlug(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DeploymentError('INVALID_SLUG', '站点 slug 必须是字符串');
  }
  const slug = value.trim().toLowerCase();
  if (
    slug.length === 0 ||
    slug.length > MAX_SLUG_LENGTH ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)
  ) {
    throw new DeploymentError('INVALID_SLUG', '站点 slug 只能使用小写字母、数字和连字符');
  }
  return slug;
}

function normalizeName(value: unknown, slug: string): string {
  if (value === undefined || value === null) return slug;
  if (typeof value !== 'string') {
    throw new DeploymentError('INVALID_NAME', '站点名称必须是字符串');
  }
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new DeploymentError('INVALID_NAME', '站点名称长度无效');
  }
  return name;
}

function normalizeMimeType(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'application/octet-stream';
  if (typeof value !== 'string' || value.length > 256 || /[\r\n]/.test(value)) {
    throw new DeploymentError('INVALID_MIME_TYPE', '文件类型无效');
  }
  return value;
}

export function validateManifest(input: DeploymentManifestInput, env: Env): ValidatedManifest {
  const slug = normalizeSlug(input.slug);
  const name = normalizeName(input.name, slug);
  const entryPath = normalizeRelativePath(input.entryPath);
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new DeploymentError('INVALID_MANIFEST', '发布清单不能为空');
  }

  const { maxFiles, maxFileBytes, maxSiteBytes } = deploymentLimits(env);
  if (input.files.length > maxFiles) {
    throw new DeploymentError('FILE_LIMIT_EXCEEDED', `文件数量不能超过 ${maxFiles}`);
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const files: ManifestFileInput[] = [];
  for (const rawFile of input.files) {
    if (!rawFile || typeof rawFile !== 'object') {
      throw new DeploymentError('INVALID_MANIFEST', '发布清单包含无效文件');
    }
    const file = rawFile as { path?: unknown; size?: unknown; mimeType?: unknown; mime_type?: unknown };
    const path = normalizeRelativePath(file.path);
    if (seen.has(path)) {
      throw new DeploymentError('DUPLICATE_PATH', `文件路径重复：${path}`);
    }
    seen.add(path);

    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0 || (file.size as number) > maxFileBytes) {
      throw new DeploymentError('FILE_LIMIT_EXCEEDED', `文件大小不能超过 ${maxFileBytes} 字节`);
    }
    const size = file.size as number;
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxSiteBytes) {
      throw new DeploymentError('SITE_LIMIT_EXCEEDED', `站点总大小不能超过 ${maxSiteBytes} 字节`);
    }
    files.push({
      path,
      size,
      mime_type: normalizeMimeType(file.mimeType ?? file.mime_type)
    });
  }

  if (!seen.has(entryPath)) {
    throw new DeploymentError('ENTRY_NOT_IN_MANIFEST', '入口文件不在发布清单中');
  }

  return { slug, name, entryPath, files, totalBytes };
}
