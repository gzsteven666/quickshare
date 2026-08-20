const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('app exports an Express application without listening', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickshare-app-test-'));
  process.env.DB_PATH = path.join(tempDir, 'quickshare.sqlite');
  process.env.AUTH_ENABLED = 'false';

  const app = require('../app');

  assert.equal(typeof app, 'function');
  assert.equal(app.listening, undefined);
});
