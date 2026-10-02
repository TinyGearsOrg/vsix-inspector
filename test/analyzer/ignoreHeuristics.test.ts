import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findIgnoreFindings } from '../../src/analyzer/ignoreHeuristics';
import type { VsixEntry } from '../../src/analyzer/zip';

function entry(path: string, size = 10): VsixEntry {
  return { path, uncompressedSize: size, compressedSize: size };
}

function categoriesFor(entries: VsixEntry[]): Record<string, string> {
  const findings = findIgnoreFindings(entries);
  return Object.fromEntries(findings.map((f) => [f.path, f.category]));
}

test('flags test directories, source maps, logs, vcs/editor cruft, and lockfiles', () => {
  const entries = [
    entry('extension/test/sample.test.js'),
    entry('extension/dist/main.js.map'),
    entry('extension/debug.log'),
    entry('extension/.git/HEAD'),
    entry('extension/.DS_Store'),
    entry('extension/yarn.lock'),
  ];

  const categories = categoriesFor(entries);
  assert.equal(categories['extension/test/sample.test.js'], 'test-files');
  assert.equal(categories['extension/dist/main.js.map'], 'source-maps');
  assert.equal(categories['extension/debug.log'], 'log-files');
  assert.equal(categories['extension/.git/HEAD'], 'vcs-editor-cruft');
  assert.equal(categories['extension/.DS_Store'], 'vcs-editor-cruft');
  assert.equal(categories['extension/yarn.lock'], 'lockfile');
});

test('flags stray TypeScript sources only when compiled output exists alongside them', () => {
  const withOutput = [entry('extension/src/main.ts'), entry('extension/dist/main.js')];
  assert.equal(categoriesFor(withOutput)['extension/src/main.ts'], 'stray-typescript-source');

  const withoutOutput = [entry('extension/src/main.ts')];
  assert.equal(categoriesFor(withoutOutput)['extension/src/main.ts'], undefined);
});

test('flags extra markdown but keeps README/CHANGELOG/LICENSE', () => {
  const entries = [
    entry('extension/README.md'),
    entry('extension/CHANGELOG.md'),
    entry('extension/LICENSE.md'),
    entry('extension/NOTES.md'),
  ];

  const categories = categoriesFor(entries);
  assert.equal(categories['extension/README.md'], undefined);
  assert.equal(categories['extension/CHANGELOG.md'], undefined);
  assert.equal(categories['extension/LICENSE.md'], undefined);
  assert.equal(categories['extension/NOTES.md'], 'extra-markdown');
});

test('does not flag ordinary bundled files', () => {
  const entries = [entry('extension/dist/main.js'), entry('extension/package.json')];
  assert.deepEqual(findIgnoreFindings(entries), []);
});
