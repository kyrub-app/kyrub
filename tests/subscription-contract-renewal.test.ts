import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptSubscriptionRenewalProposal, createSubscriptionRenewalProposal } from '../shared/subscriptionContractRenewal.js';

const contract = {
  contractId: 'contract-1', customerId: 'customer-1', productId: 'business', storeId: 'store-1',
  months: 12 as const, monthlyBasePriceMinor: 19990, discountPercent: 10,
  totalPaidMinor: 215892, acceptedAt: '2027-01-01T00:00:00Z',
  expiresAt: '2028-01-01T00:00:00Z',
};

test('historical contract remains unchanged after catalog price increase', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000);
  assert.equal(contract.totalPaidMinor, 215892);
  assert.equal(proposal.totalDueMinor, 480000);
  assert.equal(proposal.discountPercent, 0);
  assert.equal(proposal.status, 'awaiting_acceptance');
});

test('renewal discount applies to new full prepaid term only', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000, 10);
  assert.equal(proposal.totalDueMinor, 432000);
});

test('renewal requires matching customer, total and explicit acceptance', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000);
  assert.throws(() => acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'other', storeId: 'store-1', acceptedTotalMinor: 480000, acceptedAt: '2028-01-01T00:00:00Z',
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
  assert.throws(() => acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'customer-1', storeId: 'store-1', acceptedTotalMinor: 215892, acceptedAt: '2028-01-01T00:00:00Z',
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
  assert.equal(acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'customer-1', storeId: 'store-1', acceptedTotalMinor: 480000, acceptedAt: '2028-01-01T00:00:00Z',
  }).status, 'accepted');
});

test('rejects acceptance from another store even for the same customer and amount', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000);
  assert.throws(() => acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'customer-1', storeId: 'another-store', acceptedTotalMinor: 480000,
    acceptedAt: '2028-01-01T00:00:00Z',
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
});
