import { buildZipManifest, DEFAULT_LIMITS } from './app-core.js';

const zipLib = globalThis.zip;
const state = { archive: null, busy: false, previewUrl: '', siteId: '' };

const $ = (id) => document.getElementById(id);
const loginView = $('loginView');
const appView = $('appView');
const loginForm = $('loginForm');
const loginError = $('loginError');
const passwordInput = $('password');
const logoutButton = $('logoutButton');
const dropzone = $('dropzone');
const zipInput = $('zipInput');
const chooseButton = $('chooseButton');
const archivePanel = $('archivePanel');
const archiveName = $('archiveName');
const archiveStatus = $('archiveStatus');
const fileSummary = $('fileSummary');
const siteNameInput = $('siteName');
const siteSlugInput = $('siteSlug');
const deployButton = $('deployButton');
const clearButton = $('clearButton');
const progressArea = $('progressArea');
const progressText = $('progressText');
const progressPercent = $('progressPercent');
const progressBar = $('progressBar');
const deployError = $('deployError');
const resultPanel = $('resultPanel');
const resultSummary = $('resultSummary');
const previewLink = $('previewLink');
const openButton = $('openButton');
const copyButton = $('copyButton');
const domainPanel = $('domainPanel');
const domainForm = $('domainForm');
const hostnameInput = $('hostname');
const domainError = $('domainError');
const domainList = $('domainList');
const domainInstructions = $('domainInstructions');
const refreshSitesButton = $('refreshSitesButton');
const sitesSummary = $('sitesSummary');
const sitesList = $('sitesList');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setMessage(element, message) {
  element.textContent = message || '';
  element.hidden = !message;
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
  const contentType = response.headers.get('Content-Type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new Error(data?.error || `请求失败（${response.status}）`);
  }
  return data;
}

function showApp(authenticated) {
  loginView.hidden = authenticated;
  appView.hidden = !authenticated;
  if (authenticated) passwordInput.value = '';
}

function slugFromFilename(filename) {
  const stem = filename.replace(/\.zip$/i, '');
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
  return slug || `site-${Date.now().toString(36)}`;
}

function chooseZip(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name) && file.type !== 'application/zip') {
    setMessage(deployError, '请选择 .zip 压缩包。');
    return;
  }
  void inspectZip(file);
}

async function inspectZip(file) {
  if (!zipLib) {
    setMessage(deployError, 'ZIP 解析组件未加载，请刷新页面重试。');
    return;
  }
  resetArchive();
  archiveName.textContent = file.name;
  archiveStatus.textContent = '读取中';
  archivePanel.hidden = false;
  setMessage(deployError, '');
  try {
    const reader = new zipLib.ZipReader(new zipLib.BlobReader(file));
    const entries = await reader.getEntries();
    const manifest = buildZipManifest(entries, DEFAULT_LIMITS);
    state.archive = { file, reader, manifest };
    archiveStatus.textContent = '已读取';
    fileSummary.textContent = `${manifest.files.length} 个文件 · ${formatBytes(manifest.totalBytes)} · 入口：${manifest.entryPath}`;
    siteNameInput.value = file.name.replace(/\.zip$/i, '');
    siteSlugInput.value = slugFromFilename(file.name);
    resultPanel.hidden = true;
  } catch (error) {
    archiveStatus.textContent = '读取失败';
    setMessage(deployError, error instanceof Error ? error.message : 'ZIP 无法读取。');
    state.archive = null;
  }
}

function setProgress(done, total, message) {
  const percent = total === 0 ? 100 : Math.min(100, Math.round(done / total * 100));
  progressText.textContent = message;
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
}

async function uploadEntry(entry, created, onComplete) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const blob = await entry.entry.getData(new zipLib.BlobWriter(entry.mimeType));
      const path = new URL(`/api/deployments/${encodeURIComponent(created.versionId)}/files`, location.origin);
      path.searchParams.set('path', entry.path);
      await apiRequest(path, {
        method: 'PUT',
        headers: { 'Content-Type': entry.mimeType },
        body: blob
      });
      onComplete(entry);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new Error(`${entry.path} 上传失败：${lastError instanceof Error ? lastError.message : '未知错误'}`);
}

async function uploadEntries(entries, created, totalBytes) {
  let cursor = 0;
  let completedBytes = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      await uploadEntry(entries[index], created, (entry) => {
        completedBytes += entry.size;
        setProgress(completedBytes, totalBytes, `已上传 ${entry.path}`);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => worker()));
}

async function deployArchive() {
  if (!state.archive || state.busy) return;
  if (!siteNameInput.value.trim() || !siteSlugInput.value.trim()) {
    setMessage(deployError, '请填写站点名称和 slug。');
    return;
  }
  state.busy = true;
  deployButton.disabled = true;
  clearButton.disabled = true;
  progressArea.hidden = false;
  resultPanel.hidden = true;
  setMessage(deployError, '');
  setProgress(0, state.archive.manifest.totalBytes, '正在创建发布版本…');
  try {
    const manifest = state.archive.manifest;
    const created = await apiRequest('/api/deployments', {
      method: 'POST',
      body: JSON.stringify({
        name: siteNameInput.value.trim(),
        slug: siteSlugInput.value.trim(),
        entryPath: manifest.entryPath,
        files: manifest.files.map(({ path, size, mimeType }) => ({ path, size, mimeType }))
      })
    });
    await uploadEntries(manifest.files, created, manifest.totalBytes);
    setProgress(manifest.totalBytes, manifest.totalBytes, '正在切换线上版本…');
    const published = await apiRequest(`/api/deployments/${encodeURIComponent(created.versionId)}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ entryPath: manifest.entryPath })
    });
    state.siteId = published.siteId;
    state.previewUrl = new URL(published.previewUrl, location.origin).href;
    previewLink.href = state.previewUrl;
    previewLink.textContent = state.previewUrl;
    openButton.href = state.previewUrl;
    resultSummary.textContent = `${manifest.files.length} 个文件已发布，入口文件为 ${manifest.entryPath}。`;
    resultPanel.hidden = false;
    domainPanel.hidden = false;
    await loadSites();
    await loadDomains();
    archiveStatus.textContent = '已发布';
    setProgress(manifest.totalBytes, manifest.totalBytes, '发布完成');
  } catch (error) {
    setMessage(deployError, error instanceof Error ? error.message : '发布失败，请重试。');
    archiveStatus.textContent = '发布失败';
  } finally {
    state.busy = false;
    deployButton.disabled = false;
    clearButton.disabled = false;
    if (state.archive?.reader) {
      await state.archive.reader.close().catch(() => {});
      state.archive.reader = null;
    }
  }
}

function resetArchive() {
  if (state.archive?.reader) void state.archive.reader.close().catch(() => {});
  state.archive = null;
  state.siteId = '';
  archivePanel.hidden = true;
  resultPanel.hidden = true;
  domainPanel.hidden = true;
  domainList.replaceChildren();
  domainInstructions.hidden = true;
  progressArea.hidden = true;
  zipInput.value = '';
  setMessage(deployError, '');
  progressBar.style.width = '0%';
}

function renderDomainInstructions(instructions) {
  domainInstructions.replaceChildren();
  if (!instructions) {
    domainInstructions.hidden = true;
    return;
  }
  const title = document.createElement('strong');
  title.textContent = instructions.mode === 'wildcard-route' ? '泛域名路由指引' : '精确 Custom Domain 指引';
  const list = document.createElement('ol');
  for (const step of instructions.steps || []) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }
  const note = document.createElement('p');
  note.textContent = instructions.note || '';
  domainInstructions.append(title, list, note);
  domainInstructions.hidden = false;
}

function renderDomains(domains) {
  domainList.replaceChildren();
  if (!domains.length) {
    const empty = document.createElement('p');
    empty.className = 'summary';
    empty.textContent = '还没有绑定域名。';
    domainList.append(empty);
    return;
  }
  for (const domain of domains) {
    const row = document.createElement('div');
    row.className = 'domain-item';
    const link = document.createElement('a');
    link.href = `https://${domain.hostname}/`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = domain.hostname;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '移除映射';
    remove.addEventListener('click', async () => {
      try {
        await apiRequest(`/api/domains/${encodeURIComponent(domain.hostname)}?siteId=${encodeURIComponent(state.siteId)}`, { method: 'DELETE' });
        await loadDomains();
      } catch (error) {
        setMessage(domainError, error instanceof Error ? error.message : '移除失败。');
      }
    });
    row.append(link, remove);
    domainList.append(row);
  }
}

async function loadDomains() {
  if (!state.siteId) return;
  try {
    const data = await apiRequest(`/api/domains?siteId=${encodeURIComponent(state.siteId)}`);
    renderDomains(data.domains || []);
  } catch (error) {
    setMessage(domainError, error instanceof Error ? error.message : '域名列表读取失败。');
  }
}

function siteStatusLabel(status) {
  if (status === 'ready') return '已发布';
  if (status === 'uploading') return '上传中';
  if (status === 'failed') return '失败';
  return '未发布';
}

function formatSiteDate(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderSites(sites) {
  sitesList.replaceChildren();
  sitesSummary.textContent = sites.length ? `共 ${sites.length} 个站点` : '还没有部署站点。';
  if (!sites.length) return;

  for (const site of sites) {
    const card = document.createElement('article');
    card.className = 'site-card';

    const header = document.createElement('div');
    header.className = 'site-card-header';
    const titleBlock = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = site.name;
    const slug = document.createElement('p');
    slug.className = 'site-slug';
    slug.textContent = site.slug;
    titleBlock.append(title, slug);
    const status = document.createElement('span');
    status.className = `site-status ${site.currentStatus || ''}`;
    status.textContent = siteStatusLabel(site.currentStatus);
    header.append(titleBlock, status);

    const meta = document.createElement('div');
    meta.className = 'site-meta';
    meta.append(
      document.createTextNode(`${site.currentFileCount || 0} 个文件`),
      document.createTextNode(`版本 ${site.versionCount || 0}`),
      document.createTextNode(`入口：${site.entryPath}`),
      document.createTextNode(`更新于 ${formatSiteDate(site.updatedAt)}`)
    );

    const domains = document.createElement('div');
    domains.className = 'site-domains';
    domains.textContent = site.domains?.length ? `域名：${site.domains.join('、')}` : '尚未绑定自定义域名';

    const actions = document.createElement('div');
    actions.className = 'site-card-actions';
    if (site.currentVersionId) {
      const preview = document.createElement('a');
      preview.href = new URL(site.previewUrl, location.origin).href;
      preview.target = '_blank';
      preview.rel = 'noopener noreferrer';
      preview.textContent = '打开预览';
      const exportLink = document.createElement('a');
      exportLink.href = `/api/sites/${encodeURIComponent(site.siteId)}/export`;
      exportLink.textContent = '导出 ZIP';
      actions.append(preview, exportLink);
    }
    const remove = document.createElement('button');
    remove.className = 'danger-button';
    remove.type = 'button';
    remove.textContent = '删除站点';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`确定删除“${site.name}”吗？\n\n这会删除该站点的所有版本、R2 文件和域名映射，且无法恢复。`)) return;
      remove.disabled = true;
      remove.textContent = '删除中…';
      try {
        await apiRequest(`/api/sites/${encodeURIComponent(site.siteId)}`, { method: 'DELETE' });
        if (state.siteId === site.siteId) {
          state.siteId = '';
          domainPanel.hidden = true;
        }
        await loadSites();
      } catch (error) {
        remove.disabled = false;
        remove.textContent = '删除站点';
        window.alert(error instanceof Error ? error.message : '删除失败。');
      }
    });
    actions.append(remove);
    card.append(header, meta, domains, actions);
    sitesList.append(card);
  }
}

async function loadSites() {
  sitesSummary.textContent = '正在读取站点列表…';
  try {
    const data = await apiRequest('/api/sites');
    renderSites(data.sites || []);
  } catch (error) {
    sitesSummary.textContent = error instanceof Error ? error.message : '站点列表读取失败。';
    sitesList.replaceChildren();
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginError, '');
  try {
    await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: passwordInput.value })
    });
    showApp(true);
    void loadSites();
  } catch (error) {
    setMessage(loginError, error instanceof Error ? error.message : '登录失败。');
  }
});

logoutButton.addEventListener('click', async () => {
  try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch { /* session may already be gone */ }
  resetArchive();
  showApp(false);
});

chooseButton.addEventListener('click', (event) => {
  event.stopPropagation();
  zipInput.click();
});
dropzone.addEventListener('click', (event) => {
  if (!event.target.closest('button')) zipInput.click();
});
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    zipInput.click();
  }
});
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('is-dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragging');
  chooseZip(event.dataTransfer.files[0]);
});
zipInput.addEventListener('change', () => chooseZip(zipInput.files[0]));
deployButton.addEventListener('click', () => void deployArchive());
clearButton.addEventListener('click', resetArchive);
refreshSitesButton.addEventListener('click', () => void loadSites());
domainForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.siteId) return;
  setMessage(domainError, '');
  try {
    const data = await apiRequest('/api/domains', {
      method: 'POST',
      body: JSON.stringify({ siteId: state.siteId, hostname: hostnameInput.value.trim() })
    });
    hostnameInput.value = '';
    renderDomainInstructions(data.instructions);
    await loadDomains();
  } catch (error) {
    setMessage(domainError, error instanceof Error ? error.message : '域名映射失败。');
  }
});
copyButton.addEventListener('click', async () => {
  if (!state.previewUrl) return;
  try {
    await navigator.clipboard.writeText(state.previewUrl);
    copyButton.textContent = '已复制';
    setTimeout(() => { copyButton.textContent = '复制地址'; }, 1400);
  } catch {
    copyButton.textContent = '复制失败';
  }
});

void (async () => {
  try {
    const session = await apiRequest('/api/auth/me');
    showApp(session.authenticated === true);
    if (session.authenticated === true) void loadSites();
  } catch {
    showApp(false);
  }
})();
