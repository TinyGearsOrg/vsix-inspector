import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBuffer } from '../helpers/buildZip';
import { openVsix } from '../../src/analyzer/zip';
import { collectLicenses } from '../../src/analyzer/licenses';

test('collects the extension license plus each node_modules package license', async () => {
  const buffer = await buildZipBuffer([
    { path: 'extension/package.json', content: JSON.stringify({ name: 'demo', license: 'MIT' }) },
    {
      path: 'extension/node_modules/lodash/package.json',
      content: JSON.stringify({ name: 'lodash', license: 'MIT' }),
    },
    {
      path: 'extension/node_modules/left-pad/package.json',
      content: JSON.stringify({ name: 'left-pad' }),
    },
    {
      path: 'extension/node_modules/@scope/pkg/package.json',
      content: JSON.stringify({ name: '@scope/pkg', license: 'Apache-2.0' }),
    },
  ]);
  const archive = await openVsix(buffer);

  const licenses = await collectLicenses(archive, { name: 'demo', license: 'MIT' });
  const byName = Object.fromEntries(licenses.map((l) => [l.name, l.license]));

  assert.equal(byName['demo'], 'MIT');
  assert.equal(byName['lodash'], 'MIT');
  assert.equal(byName['left-pad'], undefined);
  assert.equal(byName['@scope/pkg'], 'Apache-2.0');
  assert.equal(licenses.length, 4);
});

test('falls back to "(extension)" when the manifest has no name', async () => {
  const archive = await openVsix(await buildZipBuffer([]));
  const licenses = await collectLicenses(archive, {});
  assert.equal(licenses[0]?.name, '(extension)');
});
