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

test('isolated provider simulation: lost response reuses the original Pix payment', async () => {
  const providerPayments = new Map<string, { id: string; body: string }>();
  let postCalls = 0;
  const fakeProviderPost = async (key: string, body: string, loseResponse = false) => {
    postCalls++;
    const existing = providerPayments.get(key);
    if (existing && existing.body !== body) throw new Error('PROVIDER_IDEMPOTENCY_CONFLICT');
    const payment = existing ?? { id: '987654321', body };
    providerPayments.set(key, payment);
    if (loseResponse) throw new Error('SIMULATED_CONNECTION_LOST');
    return payment;
  };
  const key = request.init.headers['X-Idempotency-Key'];
  await assert.rejects(fakeProviderPost(key, request.init.body, true), /SIMULATED_CONNECTION_LOST/);
  assert.equal(providerPayments.size, 1);
  const decision = decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request, persistedAttempt: attempt,
  });
  assert.equal(decision.action, 'retry_same_request');
  const recovered = await fakeProviderPost(key, request.init.body);
  assert.equal(recovered.id, '987654321');
  assert.equal(postCalls, 2);
  assert.equal(providerPayments.size, 1);
  const boundDecision = decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request,
    persistedAttempt: { ...attempt, providerPaymentId: recovered.id },
  });
  assert.deepEqual(boundDecision, { action: 'fetch_existing', paymentId: recovered.id });
  assert.equal(providerPayments.size, 1);
});

test('isolated recovery rejects changed payload before a provider retry', () => {
  const alteredRequest = {
    ...request, init: { ...request.init, body: request.init.body.replace('store-a', 'store-z') },
  };
  assert.throws(() => decidePrepaidRenewalPixRecovery({
    storeId, proposalId, request: alteredRequest, persistedAttempt: attempt,
  }), /RENEWAL_PIX_RECOVERY_CONFLICT/);
});

test('isolated provider simulation: concurrent recovery attempts share one payment', async () => {
  const payments = new Map<string, { id: string; body: string }>();
  let sequence = 0;
  const post = async (key: string, body: string) => {
    await Promise.resolve();
    const prior = payments.get(key);
    if (prior && prior.body !== body) throw new Error('PROVIDER_IDEMPOTENCY_CONFLICT');
    if (prior) return prior;
    const created = { id: String(++sequence), body };
    payments.set(key, created);
    return created;
  };
  const decisions = Array.from({ length: 8 }, () =>
    decidePrepaidRenewalPixRecovery({
      storeId, proposalId, request, persistedAttempt: attempt,
    }));
  assert.ok(decisions.every(decision => decision.action === 'retry_same_request'));
  const results = await Promise.all(decisions.map(() =>
    post(request.init.headers['X-Idempotency-Key'], request.init.body)));
  assert.equal(payments.size, 1);
  assert.equal(sequence, 1);
  assert.ok(results.every(result => result.id === '1'));
});
