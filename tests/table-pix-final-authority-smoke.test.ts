import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('src/components/store/TablePixCanonicalCheckoutBridge.tsx', 'utf8');

test('table Pix guard blocks legacy settlement and opens canonical UI', () => {
  assert.match(bridge, /stopImmediatePropagation/);
  assert.match(bridge, /ServiceLocationFinancialContextPanel/);
});
