import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeOpenDeliveryOrder } from '../server/integrations/openDelivery';

const order = (payments?: Record<string, unknown>, lastEvent = 'CONFIRMED') => ({
  id: 'provider-order-1',
  displayId: '001',
  type: 'TAKEOUT',
  lastEvent,
  items: [{ id: 'item-1', name: 'Produto', quantity: 1, unitPrice: 25 }],
  total: { orderAmount: 25, itemsPrice: 25 },
  ...(payments ? { payments } : {}),
});

const normalize = (value: unknown) => normalizeOpenDeliveryOrder(value, {
  tenantId: 'tenant-1', routingTarget: 'store-1',
});

describe('99Food payment evidence', () => {
  it('does not treat a confirmed event without payment data as paid', () => {
    const result = normalize(order());
    assert.equal(result.status, 'accepted');
    assert.equal(result.paymentStatus, 'unpaid');
    assert.equal(result.sourceChannel, '99food');
    assert.equal(result.integration.protocol, 'open-delivery');
  });
  it('preserves reported payment evidence without inventing absent fields', () => {
    const missing = normalize(order());
    assert.deepEqual(missing.integration.paymentEvidence, {
      prepaid: null,
      pending: null,
      onlineMethodPresent: false,
      methodsReported: false,
    });
    const online = normalize(order({ prepaid: 25, pending: 0, methods: [{ type: 'ONLINE', value: 25 }] }));
    assert.deepEqual(online.integration.paymentEvidence, {
      prepaid: 25,
      pending: 0,
      onlineMethodPresent: true,
      methodsReported: true,
    });
  });
  it('does not treat a missing pending amount as a settled balance', () => {
    assert.equal(normalize(order({ prepaid: 25 })).paymentStatus, 'partial');
  });
  it('marks fully prepaid only with explicit zero pending and full prepaid amount', () => {
    assert.equal(normalize(order({ prepaid: 25, pending: 0, methods: [{ type: 'ONLINE', value: 25 }] })).paymentStatus, 'paid');
  });
  it('does not infer online settlement from amounts without an online method', () => {
    assert.equal(normalize(order({ prepaid: 25, pending: 0 })).paymentStatus, 'partial');
    assert.equal(normalize(order({ prepaid: 25, pending: 0, methods: [{ type: 'OFFLINE', value: 25 }] })).paymentStatus, 'partial');
  });
  it('keeps partially paid and unpaid orders outside paid classification', () => {
    assert.equal(normalize(order({ prepaid: 10, pending: 15 })).paymentStatus, 'partial');
    assert.equal(normalize(order({ prepaid: 0, pending: 25 })).paymentStatus, 'unpaid');
  });
  it('does not treat zero-value orders as payment confirmation', () => {
    assert.equal(normalize({ ...order({ prepaid: 0, pending: 0 }), total: { orderAmount: 0, itemsPrice: 0 } }).paymentStatus, 'unpaid');
  });
});
