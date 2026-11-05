import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { acceptSubscriptionRenewalProposal, confirmPrepaidRenewalPayment, createSubscriptionRenewalProposal, snapshotAcceptedPrepaidRenewal, resolveRenewalPaymentReplay } from '../shared/subscriptionContractRenewal.js';

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

test('prepaid renewal cannot be fulfilled before verified full payment', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000);
  const accepted = acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'customer-1', storeId: 'store-1', acceptedTotalMinor: 480000,
    acceptedAt: '2028-01-01T00:00:00Z',
  });
  const valid = { providerPaymentId: 'payment-1', status: 'approved', amountMinor: 480000, verifiedByProvider: true };
  assert.throws(() => confirmPrepaidRenewalPayment(accepted, { ...valid, verifiedByProvider: false }), /RENEWAL_PAYMENT_NOT_CONFIRMED/);
  assert.throws(() => confirmPrepaidRenewalPayment(accepted, { ...valid, status: 'pending' }), /RENEWAL_PAYMENT_NOT_CONFIRMED/);
  assert.throws(() => confirmPrepaidRenewalPayment(accepted, { ...valid, amountMinor: 215892 }), /RENEWAL_PAYMENT_NOT_CONFIRMED/);
  assert.equal(confirmPrepaidRenewalPayment(accepted, valid).status, 'paid');
});

test('paid renewal snapshots current accepted price without mutating historical contract', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000);
  const accepted = acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'customer-1', storeId: 'store-1', acceptedTotalMinor: 480000,
    acceptedAt: '2028-01-01T00:00:00Z',
  });
  const paid = confirmPrepaidRenewalPayment(accepted, {
    providerPaymentId: 'payment-2', status: 'approved', amountMinor: 480000, verifiedByProvider: true,
  });
  const renewed = snapshotAcceptedPrepaidRenewal(paid, {
    newContractId: 'contract-2', startsAt: '2028-01-01T00:00:00Z', expiresAt: '2029-01-01T00:00:00Z',
  });
  assert.equal(renewed.totalPaidMinor, 480000);
  assert.equal(renewed.monthlyBasePriceMinor, 40000);
  assert.equal(renewed.previousContractId, 'contract-1');
  assert.equal(contract.totalPaidMinor, 215892);
  assert.throws(() => snapshotAcceptedPrepaidRenewal(paid, {
    newContractId: 'contract-1', startsAt: '2028-01-01T00:00:00Z', expiresAt: '2029-01-01T00:00:00Z',
  }), /INVALID_RENEWAL_CONTRACT_DATES/);
});

test('replayed payment is idempotent and cannot fund another renewal', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000);
  const accepted = acceptSubscriptionRenewalProposal(proposal, {
    customerId: 'customer-1', storeId: 'store-1', acceptedTotalMinor: 480000,
    acceptedAt: '2028-01-01T00:00:00Z',
  });
  const paid = confirmPrepaidRenewalPayment(accepted, {
    providerPaymentId: 'payment-2', status: 'approved', amountMinor: 480000, verifiedByProvider: true,
  });
  const snapshot = snapshotAcceptedPrepaidRenewal(paid, {
    newContractId: 'contract-2', startsAt: '2028-01-01T00:00:00Z', expiresAt: '2029-01-01T00:00:00Z',
  });
  assert.equal(resolveRenewalPaymentReplay(snapshot, null, null), 'create');
  assert.equal(resolveRenewalPaymentReplay(snapshot, snapshot, snapshot), 'already_recorded');
  assert.throws(() => resolveRenewalPaymentReplay({ ...snapshot, expiresAt: '2030-01-01T00:00:00Z' }, snapshot, snapshot), /RENEWAL_PAYMENT_ALREADY_USED/);
  assert.throws(() => resolveRenewalPaymentReplay({ ...snapshot, discountPercent: 10 }, snapshot, snapshot), /RENEWAL_PAYMENT_ALREADY_USED/);
  assert.throws(() => resolveRenewalPaymentReplay({ ...snapshot, contractId: 'contract-3' }, snapshot, null), /RENEWAL_PAYMENT_ALREADY_USED/);
  assert.throws(() => resolveRenewalPaymentReplay(snapshot, null, snapshot), /RENEWAL_CONTRACT_ALREADY_EXISTS/);
});

test('renewal rejects unsupported discounts and invalid term metadata', () => {
  assert.throws(() => createSubscriptionRenewalProposal(contract, 40000, -1), /INVALID_SUBSCRIPTION_CONTRACT_OFFER/);
  assert.throws(() => createSubscriptionRenewalProposal(contract, 40000, 101), /INVALID_SUBSCRIPTION_CONTRACT_OFFER/);
  assert.throws(() => createSubscriptionRenewalProposal(contract, 40000, 12.345), /INVALID_SUBSCRIPTION_CONTRACT_OFFER/);
  assert.throws(() => createSubscriptionRenewalProposal({ ...contract, months: 2 as 12 }, 40000), /INVALID_SUBSCRIPTION_CONTRACT_OFFER/);
});

test('renewal refuses malformed historical expiry values', () => {
  for (const expiresAt of [null, 0, {}, 'not-a-date']) {
    assert.throws(
      () => createSubscriptionRenewalProposal({ ...contract, expiresAt: expiresAt as string }, 40000),
      /INVALID_EXISTING_CONTRACT/,
    );
  }
});

test('renewal supports percentage discounts to two decimal places', () => {
  const proposal = createSubscriptionRenewalProposal(contract, 40000, 12.25);
  assert.equal(proposal.discountPercent, 12.25);
  assert.equal(proposal.totalDueMinor, 421200);
});

test('reconciliation API delegates to isolated HTTP boundary and provider verification', () => {
  const source = readFileSync('api/plan-control.ts', 'utf8');
  const boundary = readFileSync('server/payments/prepaidRenewalHttpBoundary.ts', 'utf8');
  assert.match(source, /handlePrepaidRenewalReconciliation/);
  assert.match(source, /recordPrepaidRenewalWithVerifiedSources/);
  assert.match(boundary, /request.method !== 'POST'/);
  assert.match(boundary, /\['storeId', 'proposalId', 'paymentId'\]/);
  assert.doesNotMatch(boundary, /transaction_amount|collector_id|accessToken|acceptedTotalMinor/);
});

test('reconciliation API maps provider mismatch to HTTP 422', () => {
  const source = readFileSync('api/plan-control.ts', 'utf8');
  const mapper = readFileSync('server/payments/prepaidRenewalHttpErrors.ts', 'utf8');
  assert.match(source, /mapPrepaidRenewalHttpError\(error\)/);
  assert.match(mapper, /code === 'RENEWAL_PROVIDER_PAYMENT_MISMATCH'/);
  assert.match(mapper, /code === 'RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED' \? 422/);
  assert.match(mapper, /status === 422 \? 'O pagamento não foi confirmado/);
});

test('authenticated Pix reconciliation requires bound attempt at transactional contract persistence', () => {
  const activation = readFileSync('server/payments/prepaidRenewalActivation.ts', 'utf8');
  const persistence = readFileSync('server/payments/persistedPrepaidRenewal.ts', 'utf8');
  const route = readFileSync('api/plan-control.ts', 'utf8');
  assert.match(route, /recordPrepaidRenewalWithVerifiedSources/);
  assert.match(activation, /verifyPrepaidRenewalMercadoPagoPayment\(/);
  assert.match(activation, /assertVerifiedPrepaidRenewalPixAttempt\(/);
  assert.match(activation, /requireBoundPixAttempt: true/);
  assert.match(activation, /input\.requireBoundPixAttempt \? input\.payment\.occurredAt : undefined/);
  assert.match(persistence, /verifiedPixPaymentApprovedAt && acceptedProposalId/);
  assert.match(persistence, /assertVerifiedPrepaidRenewalPixAttempt\(/);
  assert.match(persistence, /tx\.create\(contractRef, linkedEntitlement/);
  assert.match(persistence, /subscriptionId: linkedEntitlement\.subscriptionId/);
  assert.match(persistence, /tx\.create\(paymentRef,/);
});

test('Pix contract activation rechecks current seller after provider verification', () => {
  const source = readFileSync('server/payments/prepaidRenewalActivation.ts', 'utf8');
  const verification = source.indexOf('const payment = await verifyPrepaidRenewalMercadoPagoPayment(');
  const finalAuthority = source.indexOf('const finalAuthority = await resolveCommercialRecipientAuthority(', verification);
  const accountCheck = source.indexOf('finalRecipient.externalAccountId !== recipient.externalAccountId', finalAuthority);
  const activation = source.indexOf('return recordVerifiedPrepaidRenewal({', finalAuthority);
  assert.ok(verification >= 0 && finalAuthority > verification);
  assert.ok(accountCheck > finalAuthority && activation > accountCheck);
  assert.match(source.slice(accountCheck, activation), /RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED/);
});
