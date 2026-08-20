const AdmZip = require('adm-zip');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 500,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 30 * 1024 * 1024,
  maxPathLength: 240,
  maxCompressionRatio: 100
});

const MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
});

class DeploymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeploymentError';
    this.code = code;
  }
}

function normalizeZipPath(rawPath, maxPathLength = DEFAULT_LIMITS.maxPathLength) {
  if (typeof rawPath !== 'string') {
    throw new DeploymentError('UNSAFE_PATH', '压缩包包含无效路径');
  }

  const normalized = rawPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (
    !normalized ||
    /\0/.test(normalized) ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.some((part) => part === '..' || part.includes(':'))
  ) {
    throw new DeploymentError('UNSAFE_PATH', '压缩包包含不安全路径');
  }

  const result = parts.filter((part) => part !== '.').join('/');
  if (!result || result.length > maxPathLength) {
    throw new DeploymentError('UNSAFE_PATH', '压缩包路径过长或为空');
  }

  return result;
}

function isSymbolicLink(entry) {
  const unixMode = (entry.attr >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

function getMimeType(filePath) {
  return MIME_TYPES[path.posix.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function chooseEntryPath(filePaths) {
  const exactRootIndex = filePaths.find((filePath) => filePath.toLowerCase() === 'index.html');
  if (exactRootIndex) return exactRootIndex;

  const nestedIndexes = filePaths
    .filter((filePath) => filePath.toLowerCase().endsWith('/index.html'))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  if (nestedIndexes.length === 0) {
    throw new DeploymentError('MISSING_INDEX', '没有找到 index.html');
  }

  if (nestedIndexes.length > 1) {
    throw new DeploymentError('AMBIGUOUS_INDEX', '压缩包中存在多个 index.html，请整理站点根目录');
  }

  return nestedIndexes[0];
}

function assertSafeTarget(stagingDirectory, relativePath) {
  const stagingRoot = path.resolve(stagingDirectory) + path.sep;
  const target = path.resolve(stagingDirectory, ...relativePath.split('/'));
  if (!target.startsWith(stagingRoot)) {
    throw new DeploymentError('UNSAFE_PATH', '文件路径越出部署目录');
  }
  return target;
}

function validateHeaders(entries, limits) {
  const files = [];
  const seenPaths = new Set();
  let declaredTotalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory || entry.entryName.startsWith('__MACOSX/')) continue;
    if (isSymbolicLink(entry)) {
      throw new DeploymentError('UNSAFE_PATH', '压缩包不能包含符号链接');
    }

    const relativePath = normalizeZipPath(entry.entryName, limits.maxPathLength);
    if (relativePath.startsWith('__MACOSX/')) continue;
    if (seenPaths.has(relativePath)) {
      throw new DeploymentError('INVALID_ZIP', `压缩包包含重复文件：${relativePath}`);
    }
    seenPaths.add(relativePath);

    const size = Number(entry.header.size) || 0;
    const compressedSize = Number(entry.header.compressedSize) || 0;
    if (size > limits.maxFileBytes) {
      throw new DeploymentError('UNPACKED_SIZE_EXCEEDED', `文件 ${relativePath} 超过大小限制`);
    }
    if (size > 0 && compressedSize === 0) {
      throw new DeploymentError('UNPACKED_SIZE_EXCEEDED', '压缩包压缩比异常');
    }
    if (compressedSize > 0 && size / compressedSize > limits.maxCompressionRatio) {
      throw new DeploymentError('UNPACKED_SIZE_EXCEEDED', '压缩包压缩比异常');
    }

    declaredTotalBytes += size;
    if (declaredTotalBytes > limits.maxTotalBytes) {
      throw new DeploymentError('UNPACKED_SIZE_EXCEEDED', '解压后的站点超过大小限制');
    }

    files.push({ entry, path: relativePath, declaredSize: size });
    if (files.length > limits.maxFiles) {
      throw new DeploymentError('TOO_MANY_FILES', '压缩包文件数量超过限制');
    }
  }

  if (files.length === 0) {
    throw new DeploymentError('INVALID_ZIP', '压缩包中没有可部署的文件');
  }

  return files;
}

async function inspectAndExtractZip(zipPath, stagingDirectory, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  let entries;

  try {
    const zip = new AdmZip(zipPath);
    entries = zip.getEntries();
  } catch (error) {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
    throw new DeploymentError('INVALID_ZIP', '无法读取 ZIP 文件');
  }

  try {
    const files = validateHeaders(entries, limits);
    const entryPath = chooseEntryPath(files.map((file) => file.path));
    await fs.promises.mkdir(stagingDirectory, { recursive: true });

    let totalBytes = 0;
    const manifest = [];
    for (const file of files) {
      let content;
      try {
        content = file.entry.getData();
      } catch (error) {
        throw new DeploymentError('INVALID_ZIP', `无法解压文件：${file.path}`);
      }

      if (content.length !== file.declaredSize || content.length > limits.maxFileBytes) {
        throw new DeploymentError('UNPACKED_SIZE_EXCEEDED', `文件 ${file.path} 解压大小异常`);
      }

      totalBytes += content.length;
      if (totalBytes > limits.maxTotalBytes) {
        throw new DeploymentError('UNPACKED_SIZE_EXCEEDED', '解压后的站点超过大小限制');
      }

      const target = assertSafeTarget(stagingDirectory, file.path);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, content, { flag: 'wx' });
      manifest.push({
        path: file.path,
        size: content.length,
        mimeType: getMimeType(file.path)
      });
    }

    return {
      entryPath,
      files: manifest,
      fileCount: manifest.length,
      totalBytes
    };
  } catch (error) {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
    if (error instanceof DeploymentError) throw error;
    throw new DeploymentError('INVALID_ZIP', '无法处理 ZIP 文件');
  }
}

module.exports = {
  DEFAULT_LIMITS,
  DeploymentError,
  chooseEntryPath,
  getMimeType,
  inspectAndExtractZip,
  isSymbolicLink,
  normalizeZipPath
};
