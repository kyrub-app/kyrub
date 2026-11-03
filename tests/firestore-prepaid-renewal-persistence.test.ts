import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { persistVerifiedPrepaidRenewal } from '../server/payments/persistedPrepaidRenewal.js';
import { addMonthsUtc } from '../server/payments/prepaidSubscriptionContractLifecycle.js';

// Run ONLY under the isolated Firestore Emulator invoked by test:rules.
// Never allow these regression fixtures to touch a live Firebase project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('RENEWAL_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';

const previousExpiresAt = '2028-01-01T00:00:00.000Z';

const seed = async (storeId: string, previousContractId: string, overrides: Record<string, unknown> = {}) => {
  const customerId = 'customer-' + storeId;
  const productId = 'subscription-product';
  await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${previousContractId}`).set({
    contractId: previousContractId, customerId, productId, storeId,
    months: 12, totalPaidMinor: 100000, expiresAt: previousExpiresAt,
    ...overrides,
  });
  return { customerId, productId };
};

const renewal = (storeId: string, previousContractId: string, paymentId: string) => ({
  contractId: 'renewed-' + previousContractId,
  previousContractId,
  customerId: 'customer-' + storeId,
  productId: 'subscription-product',
  storeId,
  months: 12 as const,
  monthlyBasePriceMinor: 40000,
  discountPercent: 0,
  totalPaidMinor: 480000,
  acceptedAt: '2027-01-02T00:00:00.000Z',
  startsAt: previousExpiresAt,
  expiresAt: addMonthsUtc(previousExpiresAt, 12),
  providerPaymentId: paymentId,
});

test('Firestore: simultaneous replay writes one prepaid renewal only', async () => {
  const storeId = 'renew-emulator-concurrent';
  await seed(storeId, 'original-a');
  const next = renewal(storeId, 'original-a', 'mp-emulator-concurrent-1');
  const results = await Promise.all([
    persistVerifiedPrepaidRenewal(next),
    persistVerifiedPrepaidRenewal(next),
  ]);
  assert.deepEqual(results.sort(), ['already_recorded', 'created']);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidRenewalSuccessors/original-a`
  ).get()).get('contractId'), next.contractId);
});

test('Firestore: one Mercado Pago payment cannot fund another store', async () => {
  const first = 'renew-emulator-store-one';
  const second = 'renew-emulator-store-two';
  await Promise.all([seed(first, 'original-one'), seed(second, 'original-two')]);
  const paymentId = 'mp-emulator-cross-tenant-1';
  assert.equal(await persistVerifiedPrepaidRenewal(renewal(first, 'original-one', paymentId)), 'created');
  await assert.rejects(
    persistVerifiedPrepaidRenewal(renewal(second, 'original-two', paymentId)),
    /RENEWAL_PAYMENT_ALREADY_USED/,
  );
  assert.equal((await adminDb.doc(
    `stores/${second}/prepaidSubscriptionContracts/renewed-original-two`
  ).get()).exists, false);
});

test('Firestore: invalid predecessor rejects renewal without partial writes', async () => {
  const storeId = 'renew-emulator-invalid-predecessor';
  await seed(storeId, 'original-b', { months: 6 });
  const next = renewal(storeId, 'original-b', 'mp-emulator-invalid-original-1');
  await assert.rejects(persistVerifiedPrepaidRenewal(next), /RENEWAL_PREDECESSOR_CONTRACT_MISMATCH/);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
});

test('Firestore: overlapping term cannot consume provider payment', async () => {
  const storeId = 'renew-emulator-overlap';
  await seed(storeId, 'original-c');
  const next = renewal(storeId, 'original-c', 'mp-emulator-overlap-1');
  next.startsAt = '2027-01-02T00:00:00.000Z';
  next.expiresAt = addMonthsUtc(next.startsAt, 12);
  await assert.rejects(persistVerifiedPrepaidRenewal(next), /INVALID_RENEWAL_CONTRACT_PERIOD/);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
});

test('Firestore: expired prepaid contract may restart after its original expiry', async () => {
  const storeId = 'renew-emulator-expired';
  await seed(storeId, 'original-expired');
  const next = renewal(storeId, 'original-expired', 'mp-emulator-expired-1');
  next.acceptedAt = '2028-02-01T00:00:00.000Z';
  next.startsAt = '2028-02-02T00:00:00.000Z';
  next.expiresAt = addMonthsUtc(next.startsAt, 12);
  assert.equal(await persistVerifiedPrepaidRenewal(next), 'created');
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).get('startsAt'), next.startsAt);
});

test('Firestore: concurrent distinct payments cannot create two successors for one contract', async () => {
  const storeId = 'renew-emulator-competing-payments';
  await seed(storeId, 'original-competing');
  const first = renewal(storeId, 'original-competing', 'mp-emulator-competing-1');
  const second = {
    ...renewal(storeId, 'original-competing', 'mp-emulator-competing-2'),
    contractId: 'renewed-original-competing-second',
  };
  const outcomes = await Promise.allSettled([
    persistVerifiedPrepaidRenewal(first),
    persistVerifiedPrepaidRenewal(second),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  const successor = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalSuccessors/original-competing`
  ).get();
  assert.ok([first.contractId, second.contractId].includes(successor.get('contractId')));
  const contracts = await Promise.all([first, second].map(item => adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${item.contractId}`
  ).get()));
  assert.equal(contracts.filter(doc => doc.exists).length, 1);
});

test('Firestore: competing renewals do not consume the losing payment', async () => {
  const storeId = 'renew-emulator-loser-payment';
  await seed(storeId, 'original-loser');
  const winner = renewal(storeId, 'original-loser', 'mp-emulator-winner-1');
  const loser = {
    ...renewal(storeId, 'original-loser', 'mp-emulator-loser-2'),
    contractId: 'renewed-original-loser-second',
  };
  assert.equal(await persistVerifiedPrepaidRenewal(winner), 'created');
  await assert.rejects(
    persistVerifiedPrepaidRenewal(loser),
    /RENEWAL_PREDECESSOR_ALREADY_RENEWED/,
  );
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${loser.contractId}`
  ).get()).exists, false);
  // A rejected payment remains unbound, and cannot accidentally be treated
  // as a successful second renewal during subsequent reconciliation.
  const bindings = await adminDb.collection('prepaidRenewalPaymentBindings').get();
  assert.equal(bindings.docs.some(doc => doc.get('providerPaymentId') === loser.providerPaymentId), false);
});

test('Firestore: transactional renewal rejects altered accepted proposal without consuming payment', async () => {
  const storeId = 'renew-emulator-atomic-acceptance';
  const previousContractId = 'original-atomic';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, 'mp-emulator-atomic-1');
  const proposalId = 'a'.repeat(64);
  const proposalRef = adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`);
  await proposalRef.set({
    status: 'accepted',
    acceptedBy: next.customerId,
    acceptedAt: next.acceptedAt,
    acceptedProposalDigest: 'invalidated-digest',
    proposal: {
      storeId, customerId: next.customerId, previousContractId,
      productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor,
    },
    acceptance: {
      storeId, customerId: next.customerId,
      acceptedAt: next.acceptedAt, acceptedTotalMinor: next.totalPaidMinor,
    },
  });
  await assert.rejects(
    persistVerifiedPrepaidRenewal(next, proposalId),
    /RENEWAL_ACCEPTANCE_CHANGED/,
  );
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
  const bindings = await adminDb.collection('prepaidRenewalPaymentBindings').get();
  assert.equal(bindings.docs.some(doc => doc.get('providerPaymentId') === next.providerPaymentId), false);
});

test('Firestore: valid accepted proposal is checked and renewed atomically', async () => {
  const storeId = 'renew-emulator-atomic-valid';
  const previousContractId = 'original-valid';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, 'mp-emulator-valid-atomic-1');
  const proposalId = 'b'.repeat(64);
  const proposal = {
    storeId, customerId: next.customerId, previousContractId,
    productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor,
  };
  const acceptance = {
    storeId, customerId: next.customerId,
    acceptedAt: next.acceptedAt, acceptedTotalMinor: next.totalPaidMinor,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted',
    acceptedBy: next.customerId,
    acceptedAt: next.acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    sellerCredentialScopeId: storeId,
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
    proposal, acceptance,
  });
  assert.equal(await persistVerifiedPrepaidRenewal(next, proposalId), 'created');
  assert.equal(await persistVerifiedPrepaidRenewal(next, proposalId), 'already_recorded');
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, true);
});

test('Firestore: simultaneous cross-store attempts cannot consume one payment twice', async () => {
  const firstStore = 'renew-emulator-race-store-a';
  const secondStore = 'renew-emulator-race-store-b';
  await Promise.all([
    seed(firstStore, 'original-race-a'),
    seed(secondStore, 'original-race-b'),
  ]);
  const paymentId = 'mp-emulator-race-cross-store-1';
  const first = renewal(firstStore, 'original-race-a', paymentId);
  const second = renewal(secondStore, 'original-race-b', paymentId);
  const outcomes = await Promise.allSettled([
    persistVerifiedPrepaidRenewal(first),
    persistVerifiedPrepaidRenewal(second),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  const [firstContract, secondContract] = await Promise.all([
    adminDb.doc(`stores/${firstStore}/prepaidSubscriptionContracts/${first.contractId}`).get(),
    adminDb.doc(`stores/${secondStore}/prepaidSubscriptionContracts/${second.contractId}`).get(),
  ]);
  assert.equal(Number(firstContract.exists) + Number(secondContract.exists), 1);
});

test('Firestore: transaction rejects mismatched checkout binding without writing contract', async () => {
  const storeId = 'renew-emulator-invalid-checkout-binding';
  const previousContractId = 'original-invalid-checkout';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, 'mp-emulator-invalid-checkout-1');
  const proposalId = 'c'.repeat(64);
  const proposal = {
    storeId, customerId: next.customerId, previousContractId,
    productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor,
  };
  const acceptance = {
    storeId, customerId: next.customerId,
    acceptedAt: next.acceptedAt, acceptedTotalMinor: next.totalPaidMinor,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted',
    acceptedBy: next.customerId,
    acceptedAt: next.acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    sellerCredentialScopeId: storeId,
    paymentExternalReference: 'kyrub:prepaid-renewal:another-store:another-proposal',
    proposal, acceptance,
  });
  await assert.rejects(
    persistVerifiedPrepaidRenewal(next, proposalId),
    /RENEWAL_ACCEPTANCE_CHANGED/,
  );
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
  const bindings = await adminDb.collection('prepaidRenewalPaymentBindings').get();
  assert.equal(bindings.docs.some(doc => doc.get('providerPaymentId') === next.providerPaymentId), false);
});

test('Firestore: transaction rejects another seller credential scope', async () => {
  const storeId = 'renew-emulator-invalid-seller-scope';
  const previousContractId = 'original-invalid-seller';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, 'mp-emulator-invalid-seller-1');
  const proposalId = 'd'.repeat(64);
  const proposal = {
    storeId, customerId: next.customerId, previousContractId,
    productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor,
  };
  const acceptance = {
    storeId, customerId: next.customerId,
    acceptedAt: next.acceptedAt, acceptedTotalMinor: next.totalPaidMinor,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted',
    acceptedBy: next.customerId,
    acceptedAt: next.acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    sellerCredentialScopeId: 'different-seller',
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
    proposal, acceptance,
  });
  await assert.rejects(
    persistVerifiedPrepaidRenewal(next, proposalId),
    /RENEWAL_ACCEPTANCE_CHANGED/,
  );
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
});

test('Firestore: transaction rejects contract amount different from buyer acceptance', async () => {
  const storeId = 'renew-emulator-amount-mismatch';
  const previousContractId = 'original-amount-mismatch';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, 'mp-emulator-amount-mismatch-1');
  const proposalId = 'e'.repeat(64);
  const proposal = {
    storeId, customerId: next.customerId, previousContractId,
    productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor + 100,
  };
  const acceptance = {
    storeId, customerId: next.customerId,
    acceptedAt: next.acceptedAt, acceptedTotalMinor: proposal.totalDueMinor,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted',
    acceptedBy: next.customerId,
    acceptedAt: next.acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    sellerCredentialScopeId: storeId,
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
    proposal, acceptance,
  });
  await assert.rejects(
    persistVerifiedPrepaidRenewal(next, proposalId),
    /RENEWAL_ACCEPTANCE_CHANGED/,
  );
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
});

test('Firestore: verified owner OAuth scope permits atomic prepaid renewal', async () => {
  const storeId = 'renew-emulator-owner-oauth';
  const previousContractId = 'original-owner-oauth';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, 'mp-emulator-owner-oauth-1');
  const proposalId = 'f'.repeat(64);
  const ownerScope = 'owner-user-oauth-1';
  const proposal = {
    storeId, customerId: next.customerId, previousContractId,
    productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor,
  };
  const acceptance = {
    storeId, customerId: next.customerId,
    acceptedAt: next.acceptedAt, acceptedTotalMinor: next.totalPaidMinor,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted', acceptedBy: next.customerId, acceptedAt: next.acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    sellerCredentialScopeId: ownerScope,
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
    proposal, acceptance,
  });
  await assert.rejects(
    persistVerifiedPrepaidRenewal(next, proposalId),
    /RENEWAL_ACCEPTANCE_CHANGED/,
  );
  await assert.rejects(
    persistVerifiedPrepaidRenewal(next, proposalId, 'different-owner-oauth'),
    /RENEWAL_ACCEPTANCE_CHANGED/,
  );
  assert.equal(await persistVerifiedPrepaidRenewal(next, proposalId, ownerScope), 'created');
  assert.equal(await persistVerifiedPrepaidRenewal(next, proposalId, ownerScope), 'already_recorded');
});

test('Firestore: Pix binding is rechecked atomically before creating successor', async () => {
  const storeId = 'renew-emulator-atomic-pix-binding';
  const previousContractId = 'original-pix-atomic';
  const proposalId = 'f'.repeat(64);
  const paymentId = '123456789';
  const approvedAt = '2027-01-02T00:10:00.000Z';
  await seed(storeId, previousContractId);
  const next = renewal(storeId, previousContractId, paymentId);
  const proposal = {
    storeId, customerId: next.customerId, previousContractId,
    productId: next.productId, months: next.months, totalDueMinor: next.totalPaidMinor,
  };
  const acceptance = {
    storeId, customerId: next.customerId,
    acceptedAt: next.acceptedAt, acceptedTotalMinor: next.totalPaidMinor,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted', acceptedBy: next.customerId, acceptedAt: next.acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
    sellerCredentialScopeId: storeId,
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
    proposal, acceptance,
  });
  const attemptRef = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  const attempt = {
    storeId, proposalId, status: 'reserved',
    idempotencyKey: `prepaid-renewal-${proposalId}`,
    requestDigest: 'a'.repeat(64),
    expiresAt: new Date(Date.parse(next.acceptedAt) + 30 * 60_000).toISOString(),
  };
  const persist = () => persistVerifiedPrepaidRenewal(next, proposalId, storeId, approvedAt);
  const contractRef = adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`);
  const paymentRef = adminDb.doc('prepaidRenewalPaymentBindings/' +
    createHash('sha256').update('mercado_pago:' + paymentId).digest('hex'));
  await assert.rejects(persist(), /RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH/);
  await attemptRef.set(attempt);
  await assert.rejects(persist(), /RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH/);
  await attemptRef.update({ providerPaymentId: '987654321' });
  await assert.rejects(persist(), /RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH/);
  assert.equal((await contractRef.get()).exists, false);
  assert.equal((await paymentRef.get()).exists, false);
  await attemptRef.update({ providerPaymentId: paymentId });
  const concurrent = await Promise.all([persist(), persist()]);
  assert.deepEqual(concurrent.sort(), ['already_recorded', 'created']);
  assert.equal((await contractRef.get()).exists, true);
  assert.equal((await paymentRef.get()).get('providerPaymentId'), paymentId);
});
