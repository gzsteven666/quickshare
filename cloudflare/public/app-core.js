export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 1000,
  maxFileBytes: 25 * 1024 * 1024,
  maxSiteBytes: 100 * 1024 * 1024
});

const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
  xml: 'application/xml; charset=utf-8',
  webmanifest: 'application/manifest+json'
};

export function normalizeZipPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new Error('ZIP 中包含无效文件路径');
  }
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`ZIP 文件路径不安全：${value}`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`ZIP 文件路径不安全：${value}`);
  }
  return segments.join('/');
}

export function mimeTypeForPath(path) {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[extension] || 'application/octet-stream';
}

export function selectEntryPath(paths) {
  const indexPaths = paths.filter((path) => path.toLowerCase() === 'index.html' || path.toLowerCase().endsWith('/index.html'));
  if (indexPaths.includes('index.html')) return 'index.html';
  if (indexPaths.length === 1) return indexPaths[0];
  if (indexPaths.length === 0) throw new Error('ZIP 中没有 index.html 入口文件');
  throw new Error('ZIP 中存在多个 index.html，无法确定入口');
}

export function buildZipManifest(entries, limits = DEFAULT_LIMITS) {
  const files = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.directory || entry.filename.endsWith('/')) continue;
    const path = normalizeZipPath(entry.filename);
    if (seen.has(path)) throw new Error(`ZIP 中存在重复文件：${path}`);
    seen.add(path);
    const size = Number(entry.uncompressedSize);
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes) {
      throw new Error(`文件超过单文件大小限制：${path}`);
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxSiteBytes) {
      throw new Error('ZIP 解压后的站点总大小超过限制');
    }
    files.push({ path, size, mimeType: mimeTypeForPath(path), entry });
  }

  if (files.length === 0) throw new Error('ZIP 中没有可发布的文件');
  if (files.length > limits.maxFiles) throw new Error('ZIP 文件数量超过限制');
  const entryPath = selectEntryPath(files.map((file) => file.path));
  return { files, entryPath, totalBytes };
}
