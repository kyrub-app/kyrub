import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../server/actions/firstCanonicalStoreActivationService.ts', import.meta.url),
  'utf8',
);

test('first activation is not exposed as an unverified client-side transition', () => {
  assert.match(source, /verifyFirebaseIdToken\(token\)/);
  assert.match(source, /adminDb\.runTransaction/);
  assert.match(source, /FieldValue\.serverTimestamp\(\)/);
  assert.match(source, /store\.get\('ownerId'\) !== actor\.uid/);
  assert.match(source, /personal\.get\('canonicalStoreId'\) !== input\.canonicalStoreId/);
});

test('bearer parser recognizes whitespace rather than a literal backslash', () => {
  assert.ok(source.includes(String.raw`/^Bearer\s+(.+)$/i`));
  assert.ok(!source.includes(String.raw`/^Bearer\\s+(.+)$/i`));
});

test('existing activation is reused instead of overwritten', () => {
  assert.match(source, /if \(existing !== undefined && existing !== null\)/);
  assert.match(source, /newlyActivated: false/);
});
