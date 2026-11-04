import assert from 'node:assert/strict';
import test from 'node:test';
import { searchUniqueSellerPrepaidRenewalPixPayment as search } from '../server/payments/prepaidRenewalPixSellerSearch.js';

const storeId = 'store-a';
const proposalId = 'a'.repeat(64);
const request = {
  path: '/v1/payments' as const,
  init: {
    method: 'POST' as const,
    headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` },
    body: JSON.stringify({
      transaction_amount: 29.9, payment_method_id: 'pix',
      external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
      metadata: { kyrub_store_id: storeId, kyrub_prepaid_renewal_proposal_id: proposalId },
    }),
  },
};
const payment = {
  id: 12345, status: 'pending', payment_method_id: 'pix',
  currency_id: 'BRL', collector_id: 7654321,
  transaction_amount: 29.9,
  external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
};
const makeInput = (sellerScopedRequest: (scope: string, path: string, init: RequestInit) => Promise<unknown>) => ({
  storeId, proposalId, request,
  trustedCredentialScopeId: 'owner-a', oauthCredentialScopeId: 'owner-a',
  trustedExternalAccountId: '7654321', oauthExternalAccountId: '7654321',
  sellerScopedRequest,
});
test('seller search paginates GET only, validates seller scope and unique payment', async () => {
  const calls: string[] = [];
  const result = await search(makeInput(async (scope, path, init) => {
    assert.equal(scope, 'owner-a');
    assert.equal(init.method, 'GET');
    assert.match(path, /^\/v1\/payments\/search\?/);
    const params = new URL('https://test.invalid' + path).searchParams;
    assert.equal(params.get('external_reference'), payment.external_reference);
    const offset = Number(params.get('offset'));
    calls.push(String(offset));
    return {
      paging: { total: 51, limit: 50, offset },
      results: offset === 0
        ? Array.from({ length: 50 }, (_, i) => ({ ...payment, id: 50000 + i, collector_id: 999 }))
        : [payment],
    };
  }));
  assert.deepEqual(result, payment);
  assert.deepEqual(calls, ['0', '50']);
});
test('seller search fails closed on partial pages and mismatched seller OAuth', async () => {
  await assert.rejects(search(makeInput(async () => ({
    paging: { total: 51, limit: 50, offset: 0 }, results: [payment],
  }))), /SEARCH_INCOMPLETE/);
  let calls = 0;
  await assert.rejects(search({
    ...makeInput(async () => { calls++; return {}; }),
    oauthExternalAccountId: '999',
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.equal(calls, 0);
});
test('seller search rejects ambiguous payments without selecting one', async () => {
  await assert.rejects(search(makeInput(async () => ({
    paging: { total: 2, limit: 50, offset: 0 },
    results: [payment, { ...payment, id: 12346 }],
  }))), /RENEWAL_PIX_RECONCILIATION_AMBIGUOUS/);
});

test('seller search rejects changing totals between pages', async () => {
  await assert.rejects(search(makeInput(async (_scope, path) => {
    const offset = Number(new URL('https://test.invalid' + path).searchParams.get('offset'));
    return {
      paging: { total: offset === 0 ? 51 : 52, limit: 50, offset },
      results: offset === 0
        ? Array.from({ length: 50 }, (_, i) => ({ ...payment, id: 50000 + i, collector_id: 999 }))
        : [payment],
    };
  })), /SEARCH_INCOMPLETE/);
});

test('seller search rejects duplicate provider IDs across pages', async () => {
  await assert.rejects(search(makeInput(async (_scope, path) => {
    const offset = Number(new URL('https://test.invalid' + path).searchParams.get('offset'));
    return {
      paging: { total: 51, limit: 50, offset },
      results: offset === 0
        ? Array.from({ length: 50 }, (_, i) => ({ ...payment, id: 50000 + i, collector_id: 999 }))
        : [{ ...payment, id: 50000 }],
    };
  })), /SEARCH_INCOMPLETE/);
});

test('seller search refuses oversized result sets before requesting a second page', async () => {
  let calls = 0;
  await assert.rejects(search(makeInput(async (_scope, _path, init) => {
    calls++;
    assert.equal(init.method, 'GET');
    return {
      paging: { total: 101, limit: 50, offset: 0 },
      results: Array.from({ length: 50 }, (_, i) => ({ ...payment, id: 90000 + i })),
    };
  })), /SEARCH_INCOMPLETE/);
  assert.equal(calls, 1);
});
