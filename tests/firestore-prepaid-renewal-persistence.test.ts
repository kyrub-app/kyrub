import assert from 'node:assert/strict';
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

test('Firestore: delayed renewal start cannot create a gap in prepaid coverage', async () => {
  const storeId = 'renew-emulator-gap';
  await seed(storeId, 'original-gap');
  const next = renewal(storeId, 'original-gap', 'mp-emulator-gap-1');
  next.startsAt = '2028-02-01T00:00:00.000Z';
  next.expiresAt = addMonthsUtc(next.startsAt, 12);
  await assert.rejects(persistVerifiedPrepaidRenewal(next), /INVALID_RENEWAL_CONTRACT_PERIOD/);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidSubscriptionContracts/${next.contractId}`
  ).get()).exists, false);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidRenewalSuccessors/original-gap`
  ).get()).exists, false);
});
