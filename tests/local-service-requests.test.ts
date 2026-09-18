import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildLocalServiceRequest,
  localServiceRequestId,
  localServiceRequestKindLabel,
  parseLocalServiceRequestCreateInput,
} from '../shared/localServiceRequest';
import type { LocalServiceRequest } from '../shared/localServiceRequest';
import type { CustomerOrder } from '../src/utils/customerOrders';
import { buildCustomerTableCards } from '../src/utils/customerTables';

const roomOrder = (): CustomerOrder => ({
  id: 'order-room-203',
  storeId: 'store-1',
  buyerId: 'buyer-1',
  buyerName: 'Cliente Um',
  buyerEmail: 'cliente@example.com',
  fulfillmentType: 'dine_in',
  deliveryAddress: '',
  tableCode: '',
  serviceLocation: {
    schemaVersion: 1,
    id: 'room-203',
    kind: 'room',
    label: 'Quarto 203',
  },
  customerNote: '',
  items: [{
    lineId: 'line-1',
    productId: 'product-1',
    name: 'Produto',
    price: 25,
    quantity: 2,
    paidQuantity: 0,
    transferredQuantity: 0,
    note: '',
    image: '',
    isService: false,
  }],
  subtotal: 50,
  total: 50,
  status: 'pending',
  paymentStatus: 'unpaid',
  source: 'customer',
  sourceChannel: 'kyrub',
  operatorId: '',
  operatorName: '',
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z',
});

const closeAccountRequest = (): LocalServiceRequest => buildLocalServiceRequest({
  id: localServiceRequestId('order-room-203', 'close_account'),
  storeId: 'canonical-store-1',
  legacyStoreId: 'store-1',
  orderId: 'order-room-203',
  customerId: 'buyer-1',
  kind: 'close_account',
  serviceLocation: {
    schemaVersion: 1,
    id: 'room-203',
    kind: 'room',
    label: 'Quarto 203',
  },
  requestedAt: '2026-09-16T12:05:00.000Z',
});

test('close-account is an operational request, not a payment-terminal request', () => {
  assert.deepEqual(
    parseLocalServiceRequestCreateInput({
      storeId: 'store-1',
      orderId: 'order-room-203',
      kind: 'close_account',
    }),
    { storeId: 'store-1', orderId: 'order-room-203', kind: 'close_account' }
  );
  assert.equal(localServiceRequestKindLabel('close_account'), 'Fechar conta');
  assert.throws(
    () => parseLocalServiceRequestCreateInput({
      storeId: 'store-1',
      orderId: 'order-room-203',
      kind: 'payment_terminal',
    }),
    /INPUT_INVALID/
  );
});

test('canonical room opens the same service-location card and receives close-account alert', () => {
  const cards = buildCustomerTableCards([roomOrder()], [closeAccountRequest()]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].serviceLocation.kind, 'room');
  assert.equal(cards[0].tableCode, 'Quarto 203');
  assert.equal(cards[0].pendingCount, 1);
  assert.equal(cards[0].closeAccountRequestCount, 1);
  assert.equal(cards[0].unacknowledgedRequestCount, 1);
  assert.equal(cards[0].requests[0].kind, 'close_account');
});

test('assistance and close-account can coexist on one location card', () => {
  const assistance = buildLocalServiceRequest({
    id: localServiceRequestId('order-room-203', 'assistance'),
    storeId: 'canonical-store-1',
    legacyStoreId: 'store-1',
    orderId: 'order-room-203',
    customerId: 'buyer-1',
    kind: 'assistance',
    serviceLocation: {
      schemaVersion: 1,
      id: 'room-203',
      kind: 'room',
      label: 'Quarto 203',
    },
    requestedAt: '2026-09-16T12:04:00.000Z',
  });
  const cards = buildCustomerTableCards(
    [roomOrder()],
    [assistance, closeAccountRequest()]
  );
  assert.equal(cards[0].assistanceRequestCount, 1);
  assert.equal(cards[0].closeAccountRequestCount, 1);
  assert.equal(cards[0].requests.length, 2);
});

test('close-account consults canonical payment truth without allocating legacy paid quantities', () => {
  const service = readFileSync('server/attendance/localServiceRequestService.ts', 'utf8');
  assert.match(service, /loadLocalOrderFinancialContext/);
  assert.match(service, /financial\.canonicalProjection\.state === 'paid'/);
  assert.match(service, /financial\.canonicalProjection\.outstandingAmount <= 0\.009/);
  assert.match(service, /LOCAL_ORDER_FINANCIAL_ORDER_NOT_FOUND/);
  assert.match(service, /Preserve legacy-only table compatibility/);
  assert.doesNotMatch(service, /paidQuantity\s*:/);
  assert.doesNotMatch(service, /paymentStatus\s*:/);
});

test('service request implementation does not write payment, points, provider or fiscal state', () => {
  const service = readFileSync('server/attendance/localServiceRequestService.ts', 'utf8');
  const board = readFileSync('src/components/customer/CustomerTableBoard.tsx', 'utf8');
  const pdvBridge = readFileSync('src/components/store/LocalServicePdvBridge.tsx', 'utf8');

  assert.match(service, /request\.kind === 'close_account'/);
  assert.match(service, /LOCAL_SERVICE_REQUEST_NOTHING_DUE/);
  assert.doesNotMatch(service, /CanonicalPayment|PaymentIntent|paymentStatus\s*:|paidQuantity\s*:|MercadoPago|storePointLedger|notaFiscal|fiscalEmission/i);
  assert.match(board, /Fechar conta/);
  assert.match(board, /Chamar atendimento/);
  assert.match(board, /loadActiveLocalServiceRequests/);
  assert.doesNotMatch(pdvBridge, /LocalServiceRequestInbox/);
});

test('customer close-account action is separate from assistance and explains the staff-card notification', () => {
  const actions = readFileSync('src/components/customer/CustomerLocalServiceRequestActions.tsx', 'utf8');
  assert.match(actions, /kind === 'close_account'/);
  assert.match(actions, /Fechar conta/);
  assert.match(actions, /A notificação aparece no card deste local no painel da equipe/);
  assert.doesNotMatch(actions, /Solicitar maquininha|Maquininha solicitada|payment_terminal/);
});
