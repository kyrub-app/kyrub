import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('src/components/store/TablePixCanonicalCheckoutBridge.tsx', 'utf8');

test('canonical table Pix bridge is a rendered React component', () => {
  assert.match(bridge, /export function TablePixCanonicalCheckoutBridge/);
  assert.match(bridge, /id="staff-table-canonical-pix-checkout"/);
});
