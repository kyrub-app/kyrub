import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const inboxSource = readFileSync(
  'src/components/customer/CustomerOrderInbox.tsx',
  'utf8'
);

test('KDS cards alternate backgrounds while status remains semantically visible', () => {
  assert.match(inboxSource, /type OrderCardVisualTone/);
  assert.match(inboxSource, /orderIndex % 2 === 0/);
  assert.match(inboxSource, /bg-slate-800\/80/);
  assert.match(inboxSource, /bg-slate-900\/95/);
  assert.match(inboxSource, /filteredOrders\.map\(\(order, orderIndex\)/);
  assert.match(inboxSource, /getOrderCardVisualTone\(order, orderIndex, pickupWaiting\)/);
});

test('KDS status accents cover the operational lifecycle', () => {
  assert.match(inboxSource, /case 'pending':[\s\S]*border-l-amber-400/);
  assert.match(inboxSource, /case 'accepted':[\s\S]*case 'preparing':[\s\S]*border-l-orange-400/);
  assert.match(inboxSource, /case 'ready':[\s\S]*border-l-emerald-400/);
  assert.match(inboxSource, /case 'out_for_delivery':[\s\S]*border-l-sky-400/);
  assert.match(inboxSource, /case 'rejected':[\s\S]*case 'cancelled':[\s\S]*border-l-red-400/);
  assert.match(inboxSource, /case 'completed':[\s\S]*border-l-slate-500/);
  assert.match(inboxSource, /pickupWaiting[\s\S]*border-l-cyan-400/);
});

test('KDS cards use the semantic tone for card, header and badge', () => {
  assert.match(inboxSource, /\$\{cardTone\.card\}/);
  assert.match(inboxSource, /\$\{cardTone\.headerBorder\}/);
  assert.match(inboxSource, /\$\{cardTone\.statusBadge\}/);
});
