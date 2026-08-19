import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubErpContextSnapshot } from '../shared/kyrubErpContext';
import { KYRUB_ACTION_REGISTRY } from '../shared/kyrubActions';
import {
  buildKyrubOrderStatusProposal,
  isKyrubOrderStatusIntent,
} from '../shared/kyrubOrderStatusProposal';
import { isKyrubAiActionProposal } from '../src/ai/actionEvents';

const context = (orders: KyrubErpContextSnapshot['pendingOrders']): KyrubErpContextSnapshot => ({
  source: 'authenticated_client_snapshot',
  generatedAt: new Date(0).toISOString(),
  store: null,
  products: [],
  productCount: 0,
  productsTruncated: false,
  pendingOrders: orders,
  pendingOrderCount: orders.length,
  ordersTruncated: false,
  lowStockThreshold: 5,
  availability: {
    store: true,
    products: true,
    inventory: true,
    orders: true,
  },
  warnings: [],
});

const order = (id: string, status: string) => ({
  id,
  status,
  paymentStatus: 'paid',
  fulfillmentType: 'delivery',
  total: 29.5,
  itemCount: 1,
  createdAt: '2026-08-19T12:00:00.000Z',
});

test('order status action is registered as a confirmed orders.write mutation', () => {
  assert.deepEqual(KYRUB_ACTION_REGISTRY.update_order_status, {
    type: 'update_order_status',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'orders.write',
    maxAffectedEntities: 1,
  });
});

test('deterministic order intent resolves one real order and prepares accepted transition', () => {
  const snapshot = context([order('order-test-001', 'pending')]);
  assert.equal(isKyrubOrderStatusIntent('Aceite o pedido order-test-001'), true);
  const result = buildKyrubOrderStatusProposal(
    'Aceite o pedido order-test-001',
    'conversation-orders',
    snapshot
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.type, 'update_order_status');
  assert.equal(result.proposal.orderId, 'order-test-001');
  assert.equal(result.proposal.expectedCurrentStatus, 'pending');
  assert.equal(result.proposal.nextStatus, 'accepted');
  assert.equal(result.proposal.requiresConfirmation, true);
  assert.equal(isKyrubAiActionProposal(result.proposal), true);
});

test('ambiguous order request refuses to choose between real orders', () => {
  const result = buildKyrubOrderStatusProposal(
    'Aceite o pedido',
    'conversation-orders',
    context([
      order('order-test-001', 'pending'),
      order('order-test-002', 'pending'),
    ])
  );
  assert.equal(result.kind, 'needs_order');
});

test('cancellation requires reason and preserves it in proposal', () => {
  const snapshot = context([order('order-test-001', 'accepted')]);
  assert.equal(
    buildKyrubOrderStatusProposal(
      'Cancele o pedido order-test-001',
      'conversation-orders',
      snapshot
    ).kind,
    'needs_reason'
  );

  const result = buildKyrubOrderStatusProposal(
    'Cancele o pedido order-test-001 porque cliente solicitou',
    'conversation-orders',
    snapshot
  );
  assert.equal(result.kind, 'proposal');
  if (result.kind !== 'proposal') return;
  assert.equal(result.proposal.nextStatus, 'cancelled');
  assert.equal(result.proposal.decision?.reason, 'cliente solicitou');
  assert.equal(isKyrubAiActionProposal(result.proposal), true);
});

test('invalid operational jump is blocked before confirmation', () => {
  const result = buildKyrubOrderStatusProposal(
    'Marque o pedido order-test-001 como pronto',
    'conversation-orders',
    context([order('order-test-001', 'pending')])
  );
  assert.equal(result.kind, 'invalid_transition');
});

test('official order executor reuses inventory transition and partner sync', () => {
  const facade = readFileSync('server/actions/actionExecutionFacade.ts', 'utf8');
  const executor = readFileSync('server/actions/orderStatusExecutionService.ts', 'utf8');
  assert.match(facade, /isKyrubOrderStatusExecutionRequest/);
  assert.match(facade, /executeAuthorizedKyrubOrderStatus/);
  assert.match(executor, /evaluateKyrubActionPolicy/);
  assert.match(executor, /permissions: \['orders\.write'\]/);
  assert.match(executor, /transitionOrderStatusWithInventory/);
  assert.match(executor, /sendNinetyNineFoodOrderStatus/);
  assert.match(executor, /ORDER_STATUS_STALE/);
  assert.match(executor, /kyrub_action_receipts/);
});

test('authenticated app mounts explicit order confirmation UI', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const bridge = readFileSync('src/components/KyrubAiOrderStatusActionBridge.tsx', 'utf8');
  assert.match(app, /KyrubAiOrderStatusActionBridge/);
  assert.match(bridge, /update_order_status/);
  assert.match(bridge, /Confirmar alteração/);
  assert.match(bridge, /status atual esperado|Status conferido/i);
  assert.match(bridge, /motor de estoque/i);
});

test('order mutation is routed before generative AI through operational runtime', () => {
  const runtime = readFileSync('src/ai/catalogDraftRuntime.ts', 'utf8');
  assert.match(runtime, /isKyrubOrderStatusIntent/);
  assert.match(runtime, /readKyrubErpContext\(user, \{ force: true \}\)/);
  assert.match(runtime, /buildKyrubOrderStatusProposal/);
  assert.match(runtime, /enabledActions: \['update_order_status'\]/);
});
