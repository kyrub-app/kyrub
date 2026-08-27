import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(
  new URL('../src/components/store/PickupPdvNavigationBridge.tsx', import.meta.url),
  'utf8'
);
const main = await readFile(
  new URL('../src/main.tsx', import.meta.url),
  'utf8'
);

test('pickup replaces scheduled in the top-level attendance navigation', () => {
  assert.match(bridge, /normalizedLabel\(button\) === 'AGENDADOS'/);
  assert.match(bridge, /Retirada\{pickupOrders\.length/);
  assert.match(bridge, /id="kyrub-pdv-pickup-tab"/);
  assert.match(bridge, /CalendarClock/);
  assert.match(bridge, />\s*Agendados\s*</);
});

test('top-level pickup queue keeps the authoritative six-digit handoff', () => {
  assert.match(bridge, /order\.fulfillmentType === 'pickup' && order\.status === 'ready'/);
  assert.match(bridge, /handoffCode: pickupCode/);
  assert.match(bridge, /Validar código e entregar/);
  assert.match(bridge, /Entregar pedido/);
});

test('legacy pickup KDS stage and duplicate pickup cards are hidden', () => {
  assert.match(bridge, /RETIRADA/);
  assert.match(bridge, /AGUARDANDO RETIRADA/);
  assert.match(bridge, /pickupStage\.style\.display = 'none'/);
  assert.match(bridge, /article\.style\.display = 'none'/);
});

test('the pickup PDV navigation bridge is mounted globally', () => {
  assert.match(main, /PickupPdvNavigationBridge/);
});
