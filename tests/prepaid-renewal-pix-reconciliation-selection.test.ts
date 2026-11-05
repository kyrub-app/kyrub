import assert from 'node:assert/strict';
import test from 'node:test';
import { selectUniquePrepaidRenewalPixReconciliationPayment as select } from '../server/payments/prepaidRenewalPixReconciliationSelection.js';

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
const input = (providerPayments: unknown) => ({
  request, expectedStoreId: storeId, expectedProposalId: proposalId,
  expectedCollectorId: '7654321', providerPayments, searchComplete: true,
});

test('reconciliation selects exactly one fully verified seller Pix payment', () => {
  assert.deepEqual(select(input([
    { ...payment, collector_id: 999 },
    { ...payment, external_reference: 'unrelated' },
    payment,
  ])), payment);
});
test('reconciliation rejects missing, malformed, or incomplete searches', () => {
  assert.throws(() => select(input([])), /NOT_FOUND_UNRESOLVED/);
  assert.throws(() => select(input(null)), /SEARCH_INVALID/);
  assert.throws(() => select(input(Array(101).fill(payment))), /SEARCH_INCOMPLETE/);
  assert.throws(() => select(input([{ ...payment, collector_id: 999 }])), /NOT_FOUND_UNRESOLVED/);
});
test('reconciliation never chooses arbitrarily among two matching provider IDs', () => {
  assert.throws(() => select(input([payment, { ...payment, id: 12346 }])), /AMBIGUOUS/);
});
test('reconciliation refuses cross-store and wrong payment method matches', () => {
  assert.throws(() => select(input([
    { ...payment, payment_method_id: 'credit_card' },
    { ...payment, external_reference: 'kyrub:prepaid-renewal:other-store:' + proposalId },
  ])), /NOT_FOUND_UNRESOLVED/);
});

test('reconciliation refuses a matching payment on a partial provider search page', () => {
  assert.throws(() => select({
    ...input([payment]), searchComplete: false,
  }), /SEARCH_INCOMPLETE/);
  assert.throws(() => select({
    ...input([]), searchComplete: false,
  }), /SEARCH_INCOMPLETE/);
});

test('reconciliation rejects unsafe or structured payment and collector IDs', () => {
  for (const id of [Number.MAX_SAFE_INTEGER + 1, { value: 12345 }, null]) {
    assert.throws(() => select(input([{ ...payment, id }])), /NOT_FOUND_UNRESOLVED/);
  }
  for (const collector_id of [Number.MAX_SAFE_INTEGER + 1, { value: 7654321 }, null]) {
    assert.throws(() => select(input([{ ...payment, collector_id }])), /NOT_FOUND_UNRESOLVED/);
  }
});
test('reconciliation retains exact long payment IDs as strings', () => {
  const exact = { ...payment, id: '900719925474099312345' };
  assert.deepEqual(select(input([exact])), exact);
});
