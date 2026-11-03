import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { executeScopedIsolatedPrepaidRenewalPix } from '../server/payments/prepaidRenewalPixScopedExecution.js';
import { createAuthorityCheckedPrepaidRenewalPixTransport } from '../server/payments/prepaidRenewalPixScopedTransportAdapter.js';
import { executeAuthorityGuardedIsolatedPrepaidRenewalPix } from '../server/payments/prepaidRenewalPixAuthorityGuardedExecutor.js';

const storeId = 'store-a';
const proposalId = 'a'.repeat(64);
const expiresAt = new Date(Date.now() + 600_000).toISOString();
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 29.9,
      payment_method_id: 'pix',
      date_of_expiration: expiresAt,
      external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
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
const response = {
  id: 123456, status: 'pending', payment_method_id: 'pix',
  currency_id: 'BRL', collector_id: 7654321, transaction_amount: 29.9,
  external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
};
const run = (overrides: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const input = {
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a',
    oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321',
    oauthExternalAccountId: '7654321',
    reserve: async () => { calls.push('reserve'); return { attempt }; },
    createPayment: async () => { calls.push('create'); return response; },
    fetchPayment: async () => { calls.push('fetch'); return response; },
    bindPayment: async () => { calls.push('bind'); return 'bound' as const; },
    ...overrides,
  };
  return { calls, execute: () => executeAuthorityGuardedIsolatedPrepaidRenewalPix(input) };
};
test('matching authority reaches reservation and binds verified payment', async () => {
  const { calls, execute } = run();
  assert.deepEqual(await execute(), { paymentId: '123456', binding: 'bound' });
  assert.deepEqual(calls, ['reserve', 'create', 'bind']);
});
test('mismatched OAuth account stops before reservation and transport', async () => {
  const { calls, execute } = run({ oauthExternalAccountId: '999999' });
  await assert.rejects(execute(), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, []);
});
test('mismatched credential scope stops before reservation and transport', async () => {
  const { calls, execute } = run({ oauthCredentialScopeId: 'other-owner' });
  await assert.rejects(execute(), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, []);
});
test('forged collector is rejected before binding', async () => {
  const { calls, execute } = run({ createPayment: async () => { calls.push('create'); return { ...response, collector_id: 999999 }; } });
  await assert.rejects(execute(), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.deepEqual(calls, ['reserve', 'create']);
});

test('expired unbound reservation refuses a new provider POST', async () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const body = JSON.parse(request.init.body);
  body.date_of_expiration = expired;
  const expiredRequest = { ...request, init: { ...request.init, body: JSON.stringify(body) } };
  const expiredAttempt = {
    ...attempt,
    expiresAt: expired,
    requestDigest: createHash('sha256').update(expiredRequest.init.body).digest('hex'),
  };
  const { calls, execute } = run({
    request: expiredRequest,
    reserve: async () => { calls.push('reserve'); return { attempt: expiredAttempt }; },
  });
  await assert.rejects(execute(), /RENEWAL_PIX_RECOVERY_EXPIRED_UNBOUND/);
  assert.deepEqual(calls, ['reserve']);
});
test('previously bound reservation fetches without a second POST', async () => {
  const { calls, execute } = run({
    reserve: async () => {
      calls.push('reserve');
      return { attempt: { ...attempt, providerPaymentId: '123456' } };
    },
    createPayment: async () => { calls.push('create'); throw new Error('DUPLICATE_POST'); },
    fetchPayment: async id => { calls.push('fetch'); assert.equal(id, '123456'); return response; },
    bindPayment: async id => { calls.push('bind'); assert.equal(id, '123456'); return 'already_bound' as const; },
  });
  assert.deepEqual(await execute(), { paymentId: '123456', binding: 'already_bound' });
  assert.deepEqual(calls, ['reserve', 'fetch', 'bind']);
});

test('scoped transport sends exact reserved payload using trusted seller scope', async () => {
  const calls: Array<{ scope: string; path: string; method: string }> = [];
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async (scope, path, init) => {
      calls.push({ scope, path, method: init.method });
      return response;
    },
  });
  assert.equal(await adapter.createPayment(request), response);
  assert.equal(await adapter.fetchPayment('123456'), response);
  assert.deepEqual(calls, [
    { scope: 'owner-a', path: '/v1/payments', method: 'POST' },
    { scope: 'owner-a', path: '/v1/payments/123456', method: 'GET' },
  ]);
});
test('scoped transport rejects modified retry and invalid payment lookup without network', async () => {
  let calls = 0;
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async () => { calls++; return response; },
  });
  await assert.rejects(adapter.createPayment({
    ...request, init: { ...request.init, body: request.init.body + ' ' },
  }), /RENEWAL_PIX_ATTEMPT_PAYLOAD_CHANGED/);
  await assert.rejects(adapter.fetchPayment('../123'), /INVALID_RENEWAL_PAYMENT_LOOKUP/);
  assert.equal(calls, 0);
});

test('executor plus scoped transport creates once and binds the verified provider ID', async () => {
  const network: string[] = [];
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async (scope, path, init) => {
      assert.equal(scope, 'owner-a');
      network.push(`${init.method} ${path}`);
      return response;
    },
  });
  const { calls, execute } = run({
    createPayment: adapter.createPayment,
    fetchPayment: adapter.fetchPayment,
  });
  assert.deepEqual(await execute(), { paymentId: '123456', binding: 'bound' });
  assert.deepEqual(network, ['POST /v1/payments']);
  assert.deepEqual(calls, ['reserve', 'bind']);
});
test('executor plus scoped transport refuses forged collector before binding', async () => {
  const network: string[] = [];
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async (_scope, path) => {
      network.push(path);
      return { ...response, collector_id: 999999 };
    },
  });
  const { calls, execute } = run({
    createPayment: adapter.createPayment,
    fetchPayment: adapter.fetchPayment,
  });
  await assert.rejects(execute(), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.deepEqual(network, ['/v1/payments']);
  assert.deepEqual(calls, ['reserve']);
});

test('bound attempt uses seller-scoped GET and never issues a second POST', async () => {
  const network: string[] = [];
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async (scope, path, init) => {
      assert.equal(scope, 'owner-a');
      network.push(`${init.method} ${path}`);
      return response;
    },
  });
  const { calls, execute } = run({
    reserve: async () => {
      calls.push('reserve');
      return { attempt: { ...attempt, providerPaymentId: '123456' } };
    },
    createPayment: adapter.createPayment,
    fetchPayment: adapter.fetchPayment,
    bindPayment: async id => {
      calls.push('bind');
      assert.equal(id, '123456');
      return 'already_bound' as const;
    },
  });
  assert.deepEqual(await execute(), { paymentId: '123456', binding: 'already_bound' });
  assert.deepEqual(network, ['GET /v1/payments/123456']);
  assert.deepEqual(calls, ['reserve', 'bind']);
});

test('provider timeout never binds an unverified payment', async () => {
  const network: string[] = [];
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async (_scope, path, init) => {
      network.push(`${init.method} ${path}`);
      throw new Error('SIMULATED_PROVIDER_TIMEOUT');
    },
  });
  const { calls, execute } = run({
    createPayment: adapter.createPayment,
    fetchPayment: adapter.fetchPayment,
  });
  await assert.rejects(execute(), /SIMULATED_PROVIDER_TIMEOUT/);
  assert.deepEqual(network, ['POST /v1/payments']);
  assert.deepEqual(calls, ['reserve']);
});
test('existing payment with mismatched ID is never rebound', async () => {
  const network: string[] = [];
  const adapter = createAuthorityCheckedPrepaidRenewalPixTransport({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    sellerScopedRequest: async (_scope, path, init) => {
      network.push(`${init.method} ${path}`);
      return { ...response, id: 987654 };
    },
  });
  const { calls, execute } = run({
    reserve: async () => {
      calls.push('reserve');
      return { attempt: { ...attempt, providerPaymentId: '123456' } };
    },
    createPayment: adapter.createPayment,
    fetchPayment: adapter.fetchPayment,
  });
  await assert.rejects(execute(), /RENEWAL_PIX_RECOVERY_CONFLICT/);
  assert.deepEqual(network, ['GET /v1/payments/123456']);
  assert.deepEqual(calls, ['reserve']);
});

test('composed scoped executor shares merchant authority across create and binding', async () => {
  const calls: string[] = [];
  const result = await executeScopedIsolatedPrepaidRenewalPix({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    reserve: async () => { calls.push('reserve'); return { attempt }; },
    sellerScopedRequest: async (scope, path, init) => {
      calls.push(`${scope}:${init.method}:${path}`);
      return response;
    },
    bindPayment: async id => {
      calls.push('bind:' + id);
      return 'bound';
    },
  });
  assert.deepEqual(result, { paymentId: '123456', binding: 'bound' });
  assert.deepEqual(calls, ['reserve', 'owner-a:POST:/v1/payments', 'bind:123456']);
});
test('composed scoped executor rejects mismatched OAuth before reservation or network', async () => {
  const calls: string[] = [];
  await assert.rejects(executeScopedIsolatedPrepaidRenewalPix({
    storeId, proposalId, request,
    trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'other-owner',
    trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
    reserve: async () => { calls.push('reserve'); return { attempt }; },
    sellerScopedRequest: async () => { calls.push('network'); return response; },
    bindPayment: async () => { calls.push('bind'); return 'bound'; },
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, []);
});
