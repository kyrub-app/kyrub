import assert from 'node:assert/strict';
import test from 'node:test';
import { decidePrepaidRenewalPixExecutionGate } from '../server/payments/prepaidRenewalPixExecutionGate.js';

const nowMs = Date.parse('2026-11-03T12:00:00.000Z');
const attempt = {
  storeId: 'store-a', proposalId: 'a'.repeat(64),
  idempotencyKey: `prepaid-renewal-${'a'.repeat(64)}`,
  requestDigest: 'b'.repeat(64), status: 'reserved' as const,
  expiresAt: new Date(nowMs + 600_000).toISOString(),
};
const input = {
  attempt, expectedStoreId: attempt.storeId,
  expectedProposalId: attempt.proposalId,
  expectedRequestDigest: attempt.requestDigest, nowMs,
  executionState: 'idle' as const,
};

test('unbound idle attempt can be claimed', () => {
  assert.equal(decidePrepaidRenewalPixExecutionGate(input), 'claim');
});
test('in-flight and ambiguous outcomes never authorize another POST', () => {
  for (const executionState of ['in_flight', 'outcome_unknown'] as const) {
    assert.throws(() => decidePrepaidRenewalPixExecutionGate({ ...input, executionState }),
      /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  }
});
test('bound attempt can only be fetched even if execution state is unknown', () => {
  assert.equal(decidePrepaidRenewalPixExecutionGate({
    ...input, attempt: { ...attempt, providerPaymentId: '123456' },
    executionState: 'outcome_unknown',
  }), 'fetch_bound');
});
test('expired unbound attempt cannot be claimed', () => {
  assert.throws(() => decidePrepaidRenewalPixExecutionGate({
    ...input, nowMs: nowMs + 600_001,
  }), /RENEWAL_PIX_EXECUTION_GATE_EXPIRED/);
});
test('foreign store, digest and invalid payment binding are rejected', () => {
  assert.throws(() => decidePrepaidRenewalPixExecutionGate({
    ...input, expectedStoreId: 'store-b',
  }), /RENEWAL_PIX_EXECUTION_GATE_CONFLICT/);
  assert.throws(() => decidePrepaidRenewalPixExecutionGate({
    ...input, expectedRequestDigest: 'c'.repeat(64),
  }), /RENEWAL_PIX_EXECUTION_GATE_CONFLICT/);
  assert.throws(() => decidePrepaidRenewalPixExecutionGate({
    ...input, attempt: { ...attempt, providerPaymentId: '../123' },
  }), /RENEWAL_PIX_EXECUTION_GATE_CONFLICT/);
});
