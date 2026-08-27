import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const inbox = await readFile(
  new URL('../src/components/customer/CustomerOrderInbox.tsx', import.meta.url),
  'utf8'
);
const main = await readFile(
  new URL('../src/main.tsx', import.meta.url),
  'utf8'
);

test('pickup ready orders have a native Retirada stage', () => {
  assert.match(inbox, /\| 'pickup'/);
  assert.match(inbox, /label: pickupCount > 0 \? `Retirada \(\$\{pickupCount\}\)` : 'Retirada'/);
  assert.match(inbox, /order\.fulfillmentType === 'pickup' && order\.status === 'ready'/);
  assert.match(inbox, /Entregar pedido/);
});

test('pickup completion requires the customer handoff code in the native inbox', () => {
  assert.match(inbox, /handoffCode: pickupCode/);
  assert.match(inbox, /\/\^\\d\{6\}\$\//);
  assert.match(inbox, /Validar código e entregar/);
});

test('staff legacy pickup bridge is no longer mounted globally', () => {
  assert.doesNotMatch(main, /PickupHandoffBridge/);
  assert.match(main, /BuyerPickupCodeBridge/);
});
