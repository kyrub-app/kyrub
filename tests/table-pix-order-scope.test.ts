import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync(
  'src/components/store/TablePixCanonicalCheckoutBridge.tsx',
  'utf8'
);

test('table Pix resolves active orders instead of sending a browser-computed table amount', () => {
  assert.match(bridge, /selectedOrdersForTable/);
  assert.match(bridge, /getCustomerOrderOutstandingTotal/);
  assert.doesNotMatch(bridge, /amount:/);
});
