const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DeploymentError,
  inspectAndExtractZip,
  normalizeZipPath
} = require('../services/zipInspector');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quickshare-zip-test-'));
}

function writeZip(directory, files) {
  const zip = new AdmZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.addFile(filePath, Buffer.from(content));
  }
  const zipPath = path.join(directory, 'site.zip');
  zip.writeZip(zipPath);
  return zipPath;
}

test('normalizes safe paths and rejects traversal', () => {
  assert.equal(normalizeZipPath('./assets\\app.css'), 'assets/app.css');
  assert.throws(() => normalizeZipPath('../escape.html'), (error) => {
    assert.equal(error.code, 'UNSAFE_PATH');
    return true;
  });
  assert.throws(() => normalizeZipPath('C:/escape.html'), /不安全路径/);
  assert.throws(() => normalizeZipPath('/escape.html'), /不安全路径/);
});

test('extracts a root index and reports a manifest', async () => {
  const directory = tempDirectory();
  const zipPath = writeZip(directory, {
    'index.html': '<h1>hello</h1>',
    'assets/app.css': 'body { color: red }'
  });
  const staging = path.join(directory, 'staging');

  const result = await inspectAndExtractZip(zipPath, staging);

  assert.equal(result.entryPath, 'index.html');
  assert.equal(result.fileCount, 2);
  assert.equal(result.totalBytes, Buffer.byteLength('<h1>hello</h1>') + Buffer.byteLength('body { color: red }'));
  assert.equal(fs.readFileSync(path.join(staging, 'assets', 'app.css'), 'utf8'), 'body { color: red }');
});

test('keeps a single nested index and unicode files', async () => {
  const directory = tempDirectory();
  const zipPath = writeZip(directory, {
    '站点/index.html': '<h1>你好</h1>',
    '站点/人事/布惠萍.html': '<p>profile</p>',
    '总结.html': '<p>summary</p>'
  });
  const staging = path.join(directory, 'staging');

  const result = await inspectAndExtractZip(zipPath, staging);

  assert.equal(result.entryPath, '站点/index.html');
  assert.equal(fs.existsSync(path.join(staging, '站点', '人事', '布惠萍.html')), true);
  assert.equal(fs.existsSync(path.join(staging, '总结.html')), true);
});

test('rejects missing and ambiguous index files', async () => {
  const directory = tempDirectory();
  const missingZip = writeZip(directory, { 'readme.txt': 'no entry' });
  await assert.rejects(
    inspectAndExtractZip(missingZip, path.join(directory, 'missing-staging')),
    (error) => error instanceof DeploymentError && error.code === 'MISSING_INDEX'
  );

  const ambiguousZip = writeZip(directory, {
    'one/index.html': 'one',
    'two/index.html': 'two'
  });
  await assert.rejects(
    inspectAndExtractZip(ambiguousZip, path.join(directory, 'ambiguous-staging')),
    (error) => error instanceof DeploymentError && error.code === 'AMBIGUOUS_INDEX'
  );
});

test('cleans staging after a limit failure', async () => {
  const directory = tempDirectory();
  const zipPath = writeZip(directory, { 'index.html': 'too large for this test' });
  const staging = path.join(directory, 'staging');

  await assert.rejects(
    inspectAndExtractZip(zipPath, staging, { maxFileBytes: 4 }),
    (error) => error instanceof DeploymentError && error.code === 'UNPACKED_SIZE_EXCEEDED'
  );
  assert.equal(fs.existsSync(staging), false);
});

test('enforces file-count and path-length limits', async () => {
  const directory = tempDirectory();
  const zipPath = writeZip(directory, {
    'index.html': 'index',
    'assets/app.js': 'script'
  });

  await assert.rejects(
    inspectAndExtractZip(zipPath, path.join(directory, 'count-staging'), { maxFiles: 1 }),
    (error) => error instanceof DeploymentError && error.code === 'TOO_MANY_FILES'
  );

  const longPath = `${'a'.repeat(241)}.html`;
  assert.throws(() => normalizeZipPath(longPath), (error) => error.code === 'UNSAFE_PATH');
});
