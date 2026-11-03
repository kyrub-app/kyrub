import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { decidePrepaidRenewalPixRecovery } from '../server/payments/prepaidRenewalPixRetryPolicy.js';
import { decidePrepaidRenewalPixAttempt } from '../server/payments/prepaidRenewalPixAttempt.js';

const storeId = 'store-a';
const proposalId = 'b'.repeat(64);
const expiresAt = new Date(Date.now() + 600_000).toISOString();
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
      date_of_expiration: expiresAt,
      metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
    }),
  },
};
const attempt = {
  storeId, proposalId, status: 'reserved' as const,
  idempotencyKey: `prepaid-renewal-${proposalId}`,
  requestDigest: createHash('sha256').update(request.init.body).digest('hex'),
  expiresAt,
};
const recover = (overrides: Record<string, unknown> = {}) =>
  decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request,
    persistedAttempt: { ...attempt, ...overrides },
  });
test('unbound Pix retries exactly the persisted idempotent request', () => {
  assert.deepEqual(recover(), { action: 'retry_same_request' });
});
test('bound Pix fetches the existing payment without issuing a new POST', () => {
  assert.deepEqual(recover({ providerPaymentId: '12345' }), {
    action: 'fetch_existing', paymentId: '12345',
  });
});
test('rejects altered payload digest, merchant and invalid provider payment ID', () => {
  assert.throws(() => recover({ requestDigest: '0'.repeat(64) }), /RECOVERY_CONFLICT/);
  assert.throws(() => recover({ storeId: 'other' }), /RECOVERY_CONFLICT/);
  assert.throws(() => recover({ providerPaymentId: 'bad-id' }), /RECOVERY_CONFLICT/);
});
test('expired unbound attempts fail closed, but existing bound payment remains recoverable', () => {
  const expired = new Date(Date.now() - 600_000).toISOString();
  const expiredRequest = {
    ...request,
    init: {
      ...request.init,
      body: JSON.stringify({
        external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
        date_of_expiration: expired,
        metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
      }),
    },
  };
  const persistedAttempt = {
    ...attempt, expiresAt: expired,
    requestDigest: createHash('sha256').update(expiredRequest.init.body).digest('hex'),
  };
  assert.throws(() => decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request: expiredRequest, persistedAttempt,
  }), /RECOVERY_EXPIRED_UNBOUND/);
  assert.deepEqual(decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request: expiredRequest,
    persistedAttempt: { ...persistedAttempt, providerPaymentId: '12345' },
  }), { action: 'fetch_existing', paymentId: '12345' });
});

test('recovery rejects malformed proposal locator even when its persisted digest matches', () => {
  assert.throws(() => decidePrepaidRenewalPixRecovery({
    storeId,
    proposalId: 'invalid-proposal',
    request,
    persistedAttempt: { ...attempt, proposalId: 'invalid-proposal' },
  }), /RENEWAL_PIX_RECOVERY_CONFLICT/);
});

test('null JSON body fails with controlled conflict rather than a runtime TypeError', () => {
  const nullBodyRequest = {
    ...request,
    init: { ...request.init, body: 'null' },
  };
  assert.throws(() => decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request: nullBodyRequest,
    persistedAttempt: {
      ...attempt,
      requestDigest: createHash('sha256').update(nullBodyRequest.init.body).digest('hex'),
    },
  }), /RENEWAL_PIX_RECOVERY_CONFLICT/);
});

for (const invalidBody of ['null', '[]', '"invalid"', '123', 'true']) {
  test(`Pix attempt reservation rejects non-object JSON ${invalidBody} with controlled error`, () => {
    const malformedRequest = {
      ...request,
      init: { ...request.init, body: invalidBody },
    };
    assert.throws(() => decidePrepaidRenewalPixAttempt({
      storeId, proposalId, request: malformedRequest, existing: null,
    }), /RENEWAL_PIX_ATTEMPT_INVALID/);
  });
}
