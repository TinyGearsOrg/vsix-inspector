import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBuffer, injectRawPath } from '../helpers/buildZip';
import { buildReport } from '../../src/analyzer/report';

const UNSAFE_PATH = '../evil.txt';
const UNSAFE_PATH_PLACEHOLDER = 'x'.repeat(UNSAFE_PATH.length); // see test/helpers/buildZip.ts: injectRawPath

test('builds a full report from a representative vsix layout', async () => {
  const rawBuffer = await buildZipBuffer([
    {
      path: 'extension/package.json',
      content: JSON.stringify({ name: 'my-ext', version: '1.2.3', publisher: 'acme', license: 'MIT' }),
    },
    { path: 'extension/dist/main.js', content: 'console.log(1)' },
    { path: 'extension/test/sample.test.js', content: 'test' },
    { path: 'extension/README.md', content: '# readme' },
    { path: 'extension/NOTES.md', content: 'extra notes' },
    {
      path: 'extension/node_modules/lodash/package.json',
      content: JSON.stringify({ name: 'lodash', license: 'MIT' }),
    },
    { path: 'extension/node_modules/lodash/index.js', content: 'module.exports = {}' },
    {
      path: 'extension/node_modules/left-pad/package.json',
      content: JSON.stringify({ name: 'left-pad' }),
    },
    { path: UNSAFE_PATH_PLACEHOLDER, content: 'escape attempt' },
  ]);
  const buffer = injectRawPath(rawBuffer, UNSAFE_PATH_PLACEHOLDER, UNSAFE_PATH);

  const report = await buildReport(buffer);

  assert.deepEqual(report.manifest, {
    name: 'my-ext',
    version: '1.2.3',
    publisher: 'acme',
    license: 'MIT',
  });
  assert.equal(report.fileCount, 8);

  const findingCategories = Object.fromEntries(report.ignoreFindings.map((f) => [f.path, f.category]));
  assert.equal(findingCategories['extension/test/sample.test.js'], 'test-files');
  assert.equal(findingCategories['extension/NOTES.md'], 'extra-markdown');
  assert.equal(findingCategories['../evil.txt'], 'unsafe-path');
  assert.equal(findingCategories['extension/README.md'], undefined);

  const packageNames = report.unbundledPackages.map((p) => p.name).sort();
  assert.deepEqual(packageNames, ['left-pad', 'lodash']);

  const licenseByName = Object.fromEntries(report.licenses.map((l) => [l.name, l.license]));
  assert.equal(licenseByName['my-ext'], 'MIT');
  assert.equal(licenseByName['lodash'], 'MIT');
  assert.equal(licenseByName['left-pad'], undefined);
});

test('builds a report even when extension/package.json is missing', async () => {
  const buffer = await buildZipBuffer([{ path: 'extension/dist/main.js', content: 'x' }]);
  const report = await buildReport(buffer);

  assert.deepEqual(report.manifest, {});
  assert.equal(report.licenses[0]?.name, '(extension)');
});
