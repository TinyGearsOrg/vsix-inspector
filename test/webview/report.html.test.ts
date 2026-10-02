import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../../src/webview/report.html';
import type { VsixReport } from '../../src/analyzer/report';

function sampleReport(overrides: Partial<VsixReport> = {}): VsixReport {
  return {
    totalUncompressedSize: 1024 * 1024 * 2,
    totalCompressedSize: 1024 * 512,
    fileCount: 10,
    largestFiles: [{ path: 'extension/dist/main.js', size: 1024 * 900 }],
    manifest: { name: 'my-ext', version: '1.0.0' },
    ignoreFindings: [],
    unbundledPackages: [],
    licenses: [{ name: 'my-ext', license: 'MIT' }],
    ...overrides,
  };
}

test('escapes untrusted entry paths before templating', () => {
  const html = renderReport(
    sampleReport({
      ignoreFindings: [{ category: 'extra-markdown', path: '<script>alert(1)</script>.md', size: 10 }],
    }),
  );

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;.md'));
});

test('includes a summary banner with counts', () => {
  const html = renderReport(
    sampleReport({
      unbundledPackages: [{ name: 'left-pad', path: 'extension/node_modules/left-pad', fileCount: 1, size: 5 }],
      licenses: [
        { name: 'my-ext', license: 'MIT' },
        { name: 'left-pad', license: undefined },
      ],
    }),
  );

  assert.match(html, /2\.0 MB/);
  assert.match(html, /10 files/);
  assert.match(html, /1 unbundled packages/);
  assert.match(html, /1 missing licenses/);
});

test('renders MISSING for an absent license', () => {
  const html = renderReport(sampleReport({ licenses: [{ name: 'left-pad', license: undefined }] }));
  assert.match(html, /MISSING/);
});

test('renders a header row for each table', () => {
  const html = renderReport(
    sampleReport({
      ignoreFindings: [{ category: 'extra-markdown', path: 'docs/notes.md', size: 10 }],
      unbundledPackages: [{ name: 'left-pad', path: 'extension/node_modules/left-pad', fileCount: 1, size: 5 }],
    }),
  );

  assert.match(html, /<th>Path<\/th><th>Size<\/th>/);
  assert.match(html, /<th>Category<\/th><th>Path<\/th><th>Size<\/th>/);
  assert.match(html, /<th>Package<\/th><th>Files<\/th><th>Size<\/th>/);
  assert.match(html, /<th>Package<\/th><th>License<\/th>/);
});

test('renders a fallback message instead of an empty table when a list has no entries', () => {
  const html = renderReport(
    sampleReport({ ignoreFindings: [], unbundledPackages: [], largestFiles: [], licenses: [] }),
  );

  assert.ok(!html.includes('<table></table>'));
  const noneFoundCount = (html.match(/None found\./g) ?? []).length;
  assert.equal(noneFoundCount, 4);
});

test('renders a dash instead of "0 B" for unsafe-path findings', () => {
  const html = renderReport(
    sampleReport({
      ignoreFindings: [{ category: 'unsafe-path', path: '../evil.txt', size: 0 }],
    }),
  );

  assert.ok(!html.includes('0 B'));
  assert.match(html, /unsafe-path<\/td><td>\.\.\/evil\.txt<\/td><td>—<\/td>/);
});
