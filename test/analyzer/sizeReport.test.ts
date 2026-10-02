import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSizeReport } from '../../src/analyzer/sizeReport';
import type { VsixEntry } from '../../src/analyzer/zip';

function entry(path: string, size: number): VsixEntry {
  return { path, uncompressedSize: size, compressedSize: Math.ceil(size / 2) };
}

test('totals sizes and file count across all entries', () => {
  const report = buildSizeReport([entry('a.js', 100), entry('b.js', 50)]);
  assert.equal(report.totalUncompressedSize, 150);
  assert.equal(report.totalCompressedSize, 50 + 25);
  assert.equal(report.fileCount, 2);
});

test('returns the top N largest files sorted descending', () => {
  const entries = [entry('small.js', 10), entry('big.js', 1000), entry('medium.js', 100)];
  const report = buildSizeReport(entries, 2);

  assert.deepEqual(report.largestFiles, [
    { path: 'big.js', size: 1000 },
    { path: 'medium.js', size: 100 },
  ]);
});

test('defaults to top 20 largest files', () => {
  const entries = Array.from({ length: 25 }, (_, i) => entry(`file-${i}.js`, i));
  const report = buildSizeReport(entries);
  assert.equal(report.largestFiles.length, 20);
  assert.equal(report.largestFiles[0]?.path, 'file-24.js');
});
