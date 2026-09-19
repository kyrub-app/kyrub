import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);

test('bridge listens during capture so Pix guard runs before the legacy React handler', () => {
  assert.match(bridge, /document\.addEventListener\('click', interceptLegacyTablePix, true\)/);
  assert.match(bridge, /document\.removeEventListener\('click', interceptLegacyTablePix, true\)/);
});
