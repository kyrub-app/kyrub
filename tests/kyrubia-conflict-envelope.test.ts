import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubExpectedState,
  buildKyrubConflictEnvelope,
  KyrubConflictEnvelopeError,
} from '../server/actions/conflictEnvelope';

test('matching expected fields do not produce a conflict', () => {
  const conflict = buildKyrubConflictEnvelope({
    target: { entityType: 'product', entityId: 'product-1' },
    expected: { name: 'X-Burger', stock: 8 },
    observed: { name: 'X-Burger', stock: 8, privateField: 'not-projected' },
    detectedAt: new Date('2026-08-21T12:00:00.000Z'),
  });

  assert.equal(conflict, null);
});

test('state changes produce a bounded STALE_PROPOSAL envelope', () => {
  const conflict = buildKyrubConflictEnvelope({
    target: { entityType: 'product', entityId: 'product-1' },
    expected: { name: 'X-Burger', stock: 8 },
    observed: {
      name: 'X-Burger Especial',
      stock: 7,
      supplierSecret: 'must-never-leak',
    },
    detectedAt: new Date('2026-08-21T12:01:00.000Z'),
  });

  assert.ok(conflict);
  assert.equal(conflict.code, 'STALE_PROPOSAL');
  assert.equal(conflict.reason, 'STATE_CHANGED');
  assert.deepEqual(conflict.changedFields, ['name', 'stock']);
  assert.deepEqual(conflict.expected, { name: 'X-Burger', stock: 8 });
  assert.deepEqual(conflict.observed, { name: 'X-Burger Especial', stock: 7 });
  assert.equal('supplierSecret' in conflict.observed, false);
  assert.equal(conflict.requiresFreshRead, true);
  assert.equal(conflict.retryable, true);
});

test('missing entities use the same conflict contract', () => {
  const conflict = buildKyrubConflictEnvelope({
    target: { entityType: 'order', entityId: 'order-1' },
    expected: { status: 'pending' },
    observed: null,
    detectedAt: new Date('2026-08-21T12:02:00.000Z'),
  });

  assert.ok(conflict);
  assert.equal(conflict.reason, 'ENTITY_MISSING');
  assert.deepEqual(conflict.observed, { status: null });
});

test('assert helper rejects stale execution with a typed 409 conflict', () => {
  assert.throws(
    () => assertKyrubExpectedState({
      target: { entityType: 'order', entityId: 'order-2' },
      expected: { status: 'accepted' },
      observed: { status: 'completed' },
      detectedAt: new Date('2026-08-21T12:03:00.000Z'),
    }),
    error => {
      assert.ok(error instanceof KyrubConflictEnvelopeError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'STALE_PROPOSAL');
      assert.deepEqual(error.conflict.changedFields, ['status']);
      return true;
    }
  );
});
