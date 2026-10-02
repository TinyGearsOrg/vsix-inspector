import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBuffer, injectRawPath } from '../helpers/buildZip';
import { openVsix } from '../../src/analyzer/zip';

const UNSAFE_PATH = '../evil.txt';
const UNSAFE_PATH_PLACEHOLDER = 'x'.repeat(UNSAFE_PATH.length); // same byte length, valid as written

test('lists safe entries with sizes and skips unsafe paths', async () => {
  const rawBuffer = await buildZipBuffer([
    { path: 'extension/package.json', content: '{"name":"demo"}' },
    { path: UNSAFE_PATH_PLACEHOLDER, content: 'escape attempt' },
  ]);
  const buffer = injectRawPath(rawBuffer, UNSAFE_PATH_PLACEHOLDER, UNSAFE_PATH);

  const archive = await openVsix(buffer);

  assert.equal(archive.entries.length, 1);
  assert.equal(archive.entries[0]?.path, 'extension/package.json');
  assert.equal(archive.entries[0]?.uncompressedSize, Buffer.byteLength('{"name":"demo"}'));
  assert.deepEqual(archive.unsafeEntries, [UNSAFE_PATH]);
});

test('reads entry content by path', async () => {
  const buffer = await buildZipBuffer([
    { path: 'extension/package.json', content: '{"name":"demo"}' },
  ]);

  const archive = await openVsix(buffer);
  const content = await archive.readEntry('extension/package.json');

  assert.equal(content.toString('utf8'), '{"name":"demo"}');
});

test('rejects reading a path that does not exist', async () => {
  const buffer = await buildZipBuffer([{ path: 'a.txt', content: 'x' }]);
  const archive = await openVsix(buffer);

  await assert.rejects(() => archive.readEntry('missing.txt'));
});
