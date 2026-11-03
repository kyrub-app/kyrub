import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { createSubscriptionRenewalProposal } from '../shared/subscriptionContractRenewal.js';
import { persistAuthenticatedPrepaidRenewalAcceptance } from '../server/payments/prepaidRenewalAcceptance.js';
import { loadAcceptedPrepaidRenewal, recordVerifiedPrepaidRenewal } from '../server/payments/prepaidRenewalActivation.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('RENEWAL_ACCEPTANCE_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';

const storeId = 'renew-acceptance-emulator';
const customerId = 'renew-acceptance-customer';
const proposalFor = (previousContractId: string) => createSubscriptionRenewalProposal({
  contractId: previousContractId,
  storeId, customerId, productId: 'product-subscription', months: 3,
  monthlyBasePriceMinor: 10000, discountPercent: 0, totalPaidMinor: 30000,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
}, 12000);

const seed = async (proposalId: string, createdAt = '2026-11-01T00:00:00.000Z') => {
  const proposal = proposalFor('previous-' + proposalId);
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'awaiting_acceptance', proposal, createdAt,
    sellerCredentialScopeId: storeId,
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
  });
  return proposal;
};

test('Firestore: only the contract buyer can accept, and acceptance is idempotent', async () => {
  const proposalId = 'buyer-replay';
  const proposal = await seed(proposalId);
  await assert.rejects(persistAuthenticatedPrepaidRenewalAcceptance({
    storeId, proposalId, authenticatedBuyerId: 'another-customer',
    acceptedTotalMinor: proposal.totalDueMinor,
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
  assert.equal(await persistAuthenticatedPrepaidRenewalAcceptance({
    storeId, proposalId, authenticatedBuyerId: customerId,
    acceptedTotalMinor: proposal.totalDueMinor,
  }), 'accepted');
  assert.equal(await persistAuthenticatedPrepaidRenewalAcceptance({
    storeId, proposalId, authenticatedBuyerId: customerId,
    acceptedTotalMinor: proposal.totalDueMinor,
  }), 'already_accepted');
  const stored = await loadAcceptedPrepaidRenewal({
    storeId, proposalId, authenticatedBuyerId: customerId,
  });
  assert.equal(stored.proposal.totalDueMinor, proposal.totalDueMinor);
  await assert.rejects(loadAcceptedPrepaidRenewal({
    storeId, proposalId, authenticatedBuyerId: 'another-customer',
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
});

test('Firestore: mismatched total never records acceptance', async () => {
  const proposalId = 'wrong-amount';
  const proposal = await seed(proposalId);
  await assert.rejects(persistAuthenticatedPrepaidRenewalAcceptance({
    storeId, proposalId, authenticatedBuyerId: customerId,
    acceptedTotalMinor: proposal.totalDueMinor - 1,
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidRenewalProposals/${proposalId}`
  ).get()).get('status'), 'awaiting_acceptance');
});

test('Firestore: acceptance cannot precede persisted proposal creation', async () => {
  const proposalId = 'future-proposal';
  const proposal = await seed(proposalId, '2099-01-01T00:00:00.000Z');
  await assert.rejects(persistAuthenticatedPrepaidRenewalAcceptance({
    storeId, proposalId, authenticatedBuyerId: customerId,
    acceptedTotalMinor: proposal.totalDueMinor,
  }), /RENEWAL_ACCEPTANCE_PRECEDES_PROPOSAL/);
});

test('Firestore: corrupted acceptance chronology cannot be replayed as valid', async () => {
  const proposalId = 'corrupt-replay';
  const proposal = await seed(proposalId);
  const reference = adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`);
  const acceptedAt = '2026-10-31T00:00:00.000Z';
  await reference.update({
    status: 'accepted',
    acceptedBy: customerId,
    acceptedAt,
    acceptance: {
      customerId, storeId, acceptedTotalMinor: proposal.totalDueMinor, acceptedAt,
    },
  });
  await assert.rejects(persistAuthenticatedPrepaidRenewalAcceptance({
    storeId, proposalId, authenticatedBuyerId: customerId,
    acceptedTotalMinor: proposal.totalDueMinor,
  }), /RENEWAL_ALREADY_ACCEPTED/);
  await assert.rejects(loadAcceptedPrepaidRenewal({
    storeId, proposalId, authenticatedBuyerId: customerId,
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
});

test('Firestore: payment approved before buyer acceptance cannot activate a renewal', async () => {
  const proposalId = 'payment-before-acceptance';
  const proposal = await seed(proposalId);
  const acceptance = {
    customerId, storeId, acceptedTotalMinor: proposal.totalDueMinor,
    acceptedAt: '2026-11-02T12:00:00.000Z',
  };
  await assert.rejects(recordVerifiedPrepaidRenewal({
    proposal, acceptance,
    payment: {
      id: '123456789', status: 'approved',
      amountMinor: proposal.totalDueMinor,
      occurredAt: '2026-11-02T11:59:59.000Z',
      verifiedByProvider: true,
    },
    newContractId: 'contract-preapproval-rejected',
  }), /RENEWAL_PAYMENT_PRECEDES_ACCEPTANCE/);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/contract-preapproval-rejected`
  ).get()).exists, false);
});

test('Firestore: verified early renewal preserves remaining prepaid coverage', async () => {
  const proposalId = 'early-period';
  const proposal = await seed(proposalId);
  const predecessorId = proposal.previousContractId;
  await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${predecessorId}`).set({
    contractId: predecessorId, storeId, customerId,
    productId: proposal.productId, months: proposal.months,
    totalPaidMinor: 30000, expiresAt: '2027-01-01T00:00:00.000Z',
  });
  const result = await recordVerifiedPrepaidRenewal({
    proposal,
    acceptance: { storeId, customerId, acceptedTotalMinor: proposal.totalDueMinor,
      acceptedAt: '2026-11-02T12:00:00.000Z' },
    payment: { id: '900000000001', status: 'approved', amountMinor: proposal.totalDueMinor,
      occurredAt: '2026-11-02T12:01:00.000Z', verifiedByProvider: true },
    newContractId: 'contract-early-period',
  });
  assert.equal(result, 'created');
  const saved = await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/contract-early-period`).get();
  assert.equal(saved.get('startsAt'), '2027-01-01T00:00:00.000Z');
  assert.equal(saved.get('expiresAt'), '2027-04-01T00:00:00.000Z');
});

test('Firestore: verified renewal after expiry starts at payment approval', async () => {
  const proposalId = 'expired-period';
  const proposal = await seed(proposalId);
  const predecessorId = proposal.previousContractId;
  await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${predecessorId}`).set({
    contractId: predecessorId, storeId, customerId,
    productId: proposal.productId, months: proposal.months,
    totalPaidMinor: 30000, expiresAt: '2026-10-01T00:00:00.000Z',
  });
  const result = await recordVerifiedPrepaidRenewal({
    proposal,
    acceptance: { storeId, customerId, acceptedTotalMinor: proposal.totalDueMinor,
      acceptedAt: '2026-11-02T12:00:00.000Z' },
    payment: { id: '900000000002', status: 'approved', amountMinor: proposal.totalDueMinor,
      occurredAt: '2026-11-02T12:01:00.000Z', verifiedByProvider: true },
    newContractId: 'contract-expired-period',
  });
  assert.equal(result, 'created');
  const saved = await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/contract-expired-period`).get();
  assert.equal(saved.get('startsAt'), '2026-11-02T12:01:00.000Z');
  assert.equal(saved.get('expiresAt'), '2027-02-02T12:01:00.000Z');
});

test('Firestore: replay of verified renewal preserves the original contract', async () => {
  const proposalId = 'replay-period';
  const proposal = await seed(proposalId);
  const predecessorId = proposal.previousContractId;
  await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${predecessorId}`).set({
    contractId: predecessorId, storeId, customerId,
    productId: proposal.productId, months: proposal.months,
    totalPaidMinor: 30000, expiresAt: '2027-01-01T00:00:00.000Z',
  });
  const input = {
    proposal,
    acceptance: { storeId, customerId, acceptedTotalMinor: proposal.totalDueMinor,
      acceptedAt: '2026-11-02T12:00:00.000Z' },
    payment: { id: '900000000003', status: 'approved', amountMinor: proposal.totalDueMinor,
      occurredAt: '2026-11-02T12:01:00.000Z', verifiedByProvider: true },
    newContractId: 'contract-replay-period',
  };
  assert.equal(await recordVerifiedPrepaidRenewal(input), 'created');
  const ref = adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${input.newContractId}`);
  const original = (await ref.get()).data();
  assert.equal(await recordVerifiedPrepaidRenewal(input), 'already_recorded');
  assert.deepEqual((await ref.get()).data(), original);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidRenewalSuccessors/${predecessorId}`
  ).get()).get('contractId'), input.newContractId);
});
