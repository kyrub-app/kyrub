import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');

test('main mounts table Pix canonical checkout bridge once', () => {
  const importMatches = main.match(/TablePixCanonicalCheckoutBridge/g) ?? [];
  assert.equal(importMatches.length, 2);
  assert.match(main, /<TablePixCanonicalCheckoutBridge \/>/);
});
