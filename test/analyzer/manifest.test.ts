import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../../src/analyzer/manifest';

test('parses name, version, publisher, and license', () => {
  const buffer = Buffer.from(
    JSON.stringify({ name: 'demo', version: '1.2.3', publisher: 'acme', license: 'MIT' }),
  );

  assert.deepEqual(parseManifest(buffer), {
    name: 'demo',
    version: '1.2.3',
    publisher: 'acme',
    license: 'MIT',
  });
});

test('treats an empty license string as missing', () => {
  const buffer = Buffer.from(JSON.stringify({ name: 'demo', license: '' }));
  assert.equal(parseManifest(buffer).license, undefined);
});

test('returns an empty object for invalid JSON', () => {
  assert.deepEqual(parseManifest(Buffer.from('not json')), {});
});

test('returns an empty object when no buffer is given', () => {
  assert.deepEqual(parseManifest(undefined), {});
});
