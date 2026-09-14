import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/, '');

function page(code = source) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        value: '', style: {}, readOnly: false,
        replaceChildren() {},
        addEventListener(type, fn) {
          listeners.set(type, [...(listeners.get(type) || []), fn]);
        },
        dispatch(type, event) {
          for (const fn of listeners.get(type) || []) fn(event);
        },
        closest() { return id === 'chooseButton' ? this : null; },
        click() {
          // Match input.click(): bubble to its parent, but suppress recursive activation.
          if (this.clicking) return;
          this.clicking = true;
          const event = { target: this, stopped: false, stopPropagation() { this.stopped = true; } };
          this.dispatch('click', event);
          if (id === 'zipInput' && !event.stopped) element('dropzone').dispatch('click', event);
          this.clicking = false;
        }
      });
    }
    return elements.get(id);
  }
  const context = createContext({
    document: { getElementById: element }, Headers,
    fetch: async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => ({ authenticated: false }) }),
    zip: { BlobReader: class {}, ZipReader: class { async getEntries() { return []; } } },
    DEFAULT_LIMITS: {},
    buildZipManifest: () => ({ files: [], totalBytes: 0, entryPath: 'index.html' })
  });
  runInContext(code, context);
  return { element, run: (code) => runInContext(code, context) };
}

test('update picker retains the original site when the ZIP filename changes', async () => {
  const app = page();
  app.run("openZipPicker({ siteId: 'original-id', name: 'Original', slug: 'original-slug' })");
  assert.equal(app.run('state.updateTarget?.siteId'), 'original-id');
  await app.run("inspectZip({ name: 'different-name.zip' })");
  assert.equal(app.element('siteSlug').value, 'original-slug');
  assert.equal(app.element('siteSlug').readOnly, true);
  assert.equal(app.element('deployButton').textContent, '更新现有站点');
});

test('choosing a new-site ZIP clears an earlier update selection', async () => {
  const app = page();
  app.run("openZipPicker({ siteId: 'original-id', name: 'Original', slug: 'original-slug' })");
  app.element('chooseButton').click();
  await app.run("inspectZip({ name: 'new-site.zip' })");
  assert.equal(app.run('state.updateTarget'), null);
  assert.equal(app.element('siteSlug').value, 'new-site');
  assert.equal(app.element('siteSlug').readOnly, false);
});
