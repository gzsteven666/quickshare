// @ts-expect-error app-core.js is browser-side ESM without a generated declaration file.
import { buildZipManifest, normalizeZipPath, selectEntryPath } from '../public/app-core.js';

describe('browser ZIP manifest validation', () => {
  it('rejects traversal and absolute paths before upload', () => {
    expect(() => normalizeZipPath('../index.html')).toThrow();
    expect(() => normalizeZipPath('/index.html')).toThrow();
    expect(() => normalizeZipPath('C:/index.html')).toThrow();
  });

  it('selects the only nested index file as the entry path', () => {
    expect(selectEntryPath(['docs/index.html', 'docs/app.js'])).toBe('docs/index.html');
    expect(selectEntryPath(['index.html', 'docs/index.html'])).toBe('index.html');
  });

  it('rejects duplicate paths and archives without an entry', () => {
    expect(() => buildZipManifest([
      { filename: 'index.html', uncompressedSize: 1 },
      { filename: 'index.html', uncompressedSize: 1 }
    ])).toThrow('重复');
    expect(() => selectEntryPath(['readme.txt'])).toThrow('index.html');
  });

  it('ignores directory entries and preserves MIME and byte totals', () => {
    const result = buildZipManifest([
      { filename: 'docs/', directory: true, uncompressedSize: 0 },
      { filename: 'index.html', uncompressedSize: 12 },
      { filename: 'assets/app.js', uncompressedSize: 8 }
    ]);
    expect(result.entryPath).toBe('index.html');
    expect(result.totalBytes).toBe(20);
    expect(result.files.map((file: { mimeType: string }) => file.mimeType)).toEqual([
      'text/html; charset=utf-8',
      'text/javascript; charset=utf-8'
    ]);
  });
});
