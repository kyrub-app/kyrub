import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrepaidRenewalPixSellerRecheckingTransport } from '../server/payments/prepaidRenewalPixSellerRecheckingTransport.js';

test('seller OAuth account changed after reservation: no provider POST', async () => {
  let providerCalls = 0;
  let currentAccount = '7654321';
  const transport = createPrepaidRenewalPixSellerRecheckingTransport({
    trustedCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321',
    resolveCurrentRecipient: async () => ({ credentialScopeId: 'owner-a', externalAccountId: currentAccount }),
    sellerScopedRequest: async () => { providerCalls++; return { id: 123 }; },
  });
  // Simulate a change after the attempt was reserved, before the provider call.
  currentAccount = '9999999';
  await assert.rejects(transport('owner-a', '/v1/payments', { method: 'POST' }),
    /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.equal(providerCalls, 0);
});

test('seller credential scope changed: no provider POST', async () => {
  let providerCalls = 0;
  const transport = createPrepaidRenewalPixSellerRecheckingTransport({
    trustedCredentialScopeId: 'owner-a', trustedExternalAccountId: '7654321',
    resolveCurrentRecipient: async () => ({ credentialScopeId: 'owner-b', externalAccountId: '7654321' }),
    sellerScopedRequest: async () => { providerCalls++; },
  });
  await assert.rejects(transport('owner-a', '/v1/payments', { method: 'POST' }),
    /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.equal(providerCalls, 0);
});

test('unchanged merchant identity permits one POST and does not recheck bound GET', async () => {
  let checks = 0;
  const calls: string[] = [];
  const transport = createPrepaidRenewalPixSellerRecheckingTransport({
    trustedCredentialScopeId: 'owner-a', trustedExternalAccountId: '7654321',
    resolveCurrentRecipient: async () => { checks++; return { credentialScopeId: 'owner-a', externalAccountId: '7654321' }; },
    sellerScopedRequest: async (_scope, path, init) => { calls.push(init.method + ' ' + path); },
  });
  await transport('owner-a', '/v1/payments', { method: 'POST' });
  await transport('owner-a', '/v1/payments/123', { method: 'GET' });
  assert.equal(checks, 1);
  assert.deepEqual(calls, ['POST /v1/payments', 'GET /v1/payments/123']);
});
