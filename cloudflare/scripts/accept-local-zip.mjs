import fs from 'node:fs/promises';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { buildZipManifest, DEFAULT_LIMITS } from '../public/app-core.js';

const zipPath = process.argv[2];
const baseUrl = (process.argv[3] || 'http://127.0.0.1:8799').replace(/\/$/, '');
const password = process.env.QUICKSHARE_ACCEPT_PASSWORD || 'test-password';

if (!zipPath) {
  console.error('用法：node scripts/accept-local-zip.mjs <zip-path> [worker-url]');
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readResponse(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* plain text response */ }
  return { response, text, data };
}

const loginResult = await readResponse(await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password })
}));
assert(loginResult.response.ok, `登录失败：${loginResult.response.status} ${loginResult.text}`);
const cookie = (loginResult.response.headers.get('set-cookie') || '').split(';')[0];
assert(cookie.includes('quickshare_session='), '登录响应没有会话 Cookie');

const archiveBytes = await fs.readFile(zipPath);
const zipReader = new ZipReader(new BlobReader(new Blob([archiveBytes])));
try {
  const entries = await zipReader.getEntries();
  const manifest = buildZipManifest(entries, DEFAULT_LIMITS);
  const slug = `accept-${Date.now().toString(36)}`;
  console.log(`ZIP：${zipPath}`);
  console.log(`清单：${manifest.files.length} 个文件，${manifest.totalBytes} bytes，入口 ${manifest.entryPath}`);

  const createResult = await readResponse(await fetch(`${baseUrl}/api/deployments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: 'QuickShare acceptance',
      slug,
      entryPath: manifest.entryPath,
      files: manifest.files.map(({ path, size, mimeType }) => ({ path, size, mimeType }))
    })
  }));
  assert(createResult.response.status === 201, `创建发布失败：${createResult.response.status} ${createResult.text}`);
  const created = createResult.data;

  for (const [index, file] of manifest.files.entries()) {
    const blob = await file.entry.getData(new BlobWriter(file.mimeType));
    const url = new URL(`${baseUrl}/api/deployments/${created.versionId}/files`);
    url.searchParams.set('path', file.path);
    const uploadResult = await readResponse(await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mimeType, Cookie: cookie },
      body: blob
    }));
    assert(uploadResult.response.ok, `上传失败 ${file.path}：${uploadResult.response.status} ${uploadResult.text}`);
    console.log(`上传：${index + 1}/${manifest.files.length} ${file.path}`);
  }

  const finalizeResult = await readResponse(await fetch(`${baseUrl}/api/deployments/${created.versionId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ entryPath: manifest.entryPath })
  }));
  assert(finalizeResult.response.ok, `发布失败：${finalizeResult.response.status} ${finalizeResult.text}`);
  const published = finalizeResult.data;
  const previewUrl = new URL(published.previewUrl, baseUrl);
  const preview = await readResponse(await fetch(previewUrl));
  assert(preview.response.ok, `预览失败：${preview.response.status}`);
  assert(preview.response.headers.get('content-security-policy') === 'sandbox allow-scripts', '预览缺少 CSP sandbox');

  const cssFile = manifest.files.find((file) => file.path.endsWith('assets/report.css'));
  if (cssFile) {
    const encodedPath = cssFile.path.split('/').map(encodeURIComponent).join('/');
    const css = await readResponse(await fetch(`${previewUrl}${encodedPath}`));
    assert(css.response.ok && (css.response.headers.get('content-type') || '').includes('text/css'), 'CSS 资源访问失败');
  }
  console.log(JSON.stringify({
    success: true,
    siteId: published.siteId,
    versionId: published.versionId,
    previewUrl: previewUrl.toString(),
    entryPath: published.entryPath
  }, null, 2));
} finally {
  await zipReader.close();
}
