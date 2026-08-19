import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { CartItem, Product } from '../src/types';
import {
  buildCustomerOrder,
  canTransitionCustomerOrderStatus,
  type CustomerOrder,
  type CustomerOrderStatus,
} from '../src/utils/customerOrders';
import {
  buildOrderOriginOptions,
  getOrderOrigin,
  isOrderVisibleInKds,
  isPendingAttendanceApproval,
} from '../src/utils/orderWorkflow';

const ingressSource = readFileSync(
  'server/integrations/ninetyNineFoodIngressQueue.ts',
  'utf8'
);
const deliverySource = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-coffee',
  name: 'Café',
  description: '',
  price: 12.5,
  image: '',
  stock: 100,
  supplierId: 'store-a',
  category: 'Bebidas',
  ...overrides,
});

const cart: CartItem[] = [{ product: product(), quantity: 2 }];

const selfServiceOrder = (): CustomerOrder =>
  buildCustomerOrder(
    { uid: 'customer-a' },
    {
      storeId: 'store-a',
      buyerName: 'Cliente da mesa',
      buyerEmail: 'cliente@example.com',
      fulfillmentType: 'dine_in',
      deliveryAddress: '',
      tableCode: 'SALÃO 01 - MESA 7',
      customerNote: 'Sem açúcar',
      cart,
      itemNotes: { 'product-coffee': 'Caneca grande' },
    },
    1_700_000_000_000
  );

const advance = (
  current: CustomerOrderStatus,
  next: CustomerOrderStatus
): CustomerOrderStatus => {
  assert.equal(
    canTransitionCustomerOrderStatus(current, next),
    true,
    `${current} deveria permitir ${next}`
  );
  return next;
};

const ingressIdentity = (merchantId: string, eventId: string): string =>
  `99food-${createHash('sha256')
    .update(`${merchantId}:${eventId}`)
    .digest('hex')}`;

describe('operational test bench', () => {
  test('QR self-service remains in attendance until staff approval', () => {
    const submitted = selfServiceOrder();
    assert.equal(isPendingAttendanceApproval(submitted), true);
    assert.equal(isOrderVisibleInKds(submitted), false);

    const approvedByStaff: CustomerOrder = {
      ...submitted,
      operatorId: submitted.storeId,
      operatorName: 'Garçom responsável',
      status: 'pending',
      items: [{ ...submitted.items[0], quantity: 1, note: 'Pouco açúcar' }],
      subtotal: 12.5,
      total: 12.5,
    };

    assert.equal(isPendingAttendanceApproval(approvedByStaff), false);
    assert.equal(isOrderVisibleInKds(approvedByStaff), true);
    assert.equal(approvedByStaff.status, 'pending');
    assert.equal(approvedByStaff.items[0].quantity, 1);
  });

  test('KDS keeps its own acceptance and production lifecycle', () => {
    let status: CustomerOrderStatus = 'pending';
    status = advance(status, 'accepted');
    status = advance(status, 'preparing');
    status = advance(status, 'ready');
    status = advance(status, 'out_for_delivery');
    status = advance(status, 'completed');
    assert.equal(status, 'completed');

    assert.equal(canTransitionCustomerOrderStatus('pending', 'preparing'), false);
    assert.equal(canTransitionCustomerOrderStatus('ready', 'accepted'), false);
    assert.equal(canTransitionCustomerOrderStatus('completed', 'pending'), false);
  });

  test('origin filter distinguishes attendance, Kyrub, staff and 99Food', () => {
    const attendance = {
      ...selfServiceOrder(),
      operatorId: 'store-a',
      operatorName: 'Atendente',
    };
    const kyrub: CustomerOrder = {
      ...attendance,
      id: 'kyrub-order',
      fulfillmentType: 'pickup',
      tableCode: '',
      operatorId: '',
      operatorName: '',
    };
    const staff: CustomerOrder = {
      ...kyrub,
      id: 'staff-order',
      source: 'staff',
    };
    const food99: CustomerOrder = {
      ...kyrub,
      id: '99food-order',
      buyerId: '99food:external-1',
      operatorName: '99Food',
    };

    assert.equal(getOrderOrigin(attendance, ['SALÃO 01']).label, 'SALÃO 01');
    assert.equal(getOrderOrigin(kyrub).label, 'Kyrub Ofertas');
    assert.equal(getOrderOrigin(staff).label, 'PDV / Staff');
    assert.equal(getOrderOrigin(food99).label, '99Food');

    const options = buildOrderOriginOptions(
      [attendance, kyrub, staff, food99],
      ['SALÃO 01']
    );
    assert.deepEqual(
      new Set(options.map(option => option.label)),
      new Set(['SALÃO 01', 'Kyrub Ofertas', 'PDV / Staff', '99Food'])
    );
  });

  test('one thousand repeated 99Food deliveries remain one logical event', () => {
    const identities = Array.from({ length: 1_000 }, () =>
      ingressIdentity('merchant-a', 'event-123')
    );
    assert.equal(new Set(identities).size, 1);
    assert.match(ingressSource, /reference\.create\(/);
    assert.match(ingressSource, /already-exists|ALREADY_EXISTS/);
    assert.match(ingressSource, /where\('availableAt', '<=', Timestamp\.now\(\)\)/);
    assert.match(ingressSource, /backoffMs/);
    assert.match(ingressSource, /rawBodyBase64: FieldValue\.delete\(\)/);
  });

  test('delivery claim is atomic and fallback checks the private claim', () => {
    assert.match(deliverySource, /transaction\.create\(claimReference/);
    assert.match(deliverySource, /deliveryClaims/);
    assert.match(deliverySource, /deliveryEscalationQueue/);
    assert.match(deliverySource, /claimSnapshot\.exists/);
    assert.match(deliverySource, /courierId !== actor\.uid|courierId === actor\.uid/);
    assert.match(deliverySource, /3 \* 60 \* 1000/);
    assert.match(deliverySource, /awaiting_provider_routing/);
  });

  test('rejection contracts require reason and preserve an alternative', () => {
    const attendanceReviewSource = readFileSync(
      'server/inventory/attendanceReviewService.ts',
      'utf8'
    );
    const approvalSource = readFileSync(
      'src/components/customer/AttendanceOrderApproval.tsx',
      'utf8'
    );
    const inboxSource = readFileSync(
      'src/components/customer/CustomerOrderInbox.tsx',
      'utf8'
    );

    assert.match(attendanceReviewSource, /Explique o motivo da recusa/);
    assert.match(attendanceReviewSource, /Alternativa sugerida/);
    assert.match(approvalSource, /Motivo obrigatório/);
    assert.match(inboxSource, /suggestedAlternative/);
  });
});
