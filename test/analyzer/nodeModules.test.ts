import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnbundledPackages } from '../../src/analyzer/nodeModules';
import type { VsixEntry } from '../../src/analyzer/zip';

function entry(path: string, size = 10): VsixEntry {
  return { path, uncompressedSize: size, compressedSize: size };
}

test('groups node_modules entries by package name, summing size and file count', () => {
  const entries = [
    entry('extension/node_modules/lodash/index.js', 100),
    entry('extension/node_modules/lodash/package.json', 20),
    entry('extension/node_modules/left-pad/index.js', 5),
  ];

  const packages = findUnbundledPackages(entries).sort((a, b) => a.name.localeCompare(b.name));

  assert.deepEqual(packages, [
    { name: 'left-pad', path: 'extension/node_modules/left-pad', fileCount: 1, size: 5 },
    { name: 'lodash', path: 'extension/node_modules/lodash', fileCount: 2, size: 120 },
  ]);
});

test('handles scoped packages', () => {
  const entries = [entry('extension/node_modules/@scope/pkg/index.js', 10)];
  assert.deepEqual(findUnbundledPackages(entries), [
    { name: '@scope/pkg', path: 'extension/node_modules/@scope/pkg', fileCount: 1, size: 10 },
  ]);
});

test('returns an empty list when there is no node_modules directory', () => {
  const entries = [entry('extension/dist/main.js', 100)];
  assert.deepEqual(findUnbundledPackages(entries), []);
});
