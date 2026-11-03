import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { reservePrepaidRenewalPixAttempt } from '../server/payments/prepaidRenewalPixAttemptReservation.js';
import { buildPrepaidRenewalPixRequest } from '../server/payments/prepaidRenewalPixRequest.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('RENEWAL_PIX_RESERVATION_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';

const proposalId = 'b'.repeat(64);
const acceptedAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.parse(acceptedAt) + 30 * 60_000).toISOString();
const seed = async (storeId: string) => {
  const embedded = {
    storeId, customerId: 'buyer-emulator', totalDueMinor: 29990,
  };
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'accepted', acceptedBy: 'buyer-emulator', acceptedAt,
    acceptedProposalDigest: createHash('sha256').update(JSON.stringify(embedded)).digest('hex'),
    proposal: embedded,
    acceptance: {
      storeId, customerId: 'buyer-emulator', acceptedTotalMinor: 29990, acceptedAt,
    },
    paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
  });
};
const makeRequest = (storeId: string) => buildPrepaidRenewalPixRequest({
  storeId, proposalId, acceptedBuyerId: 'buyer-emulator',
  authenticatedBuyerId: 'buyer-emulator',
  acceptedTotalMinor: 29990, proposalTotalMinor: 29990,
  sellerCredentialScopeId: storeId,
  paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
  payerEmail: 'buyer@example.com', expiresAt,
});

test('Firestore emulator: simultaneous Pix reservations serialize to create and reuse', async () => {
  const storeId = 'renew-pix-emulator-concurrent';
  await seed(storeId);
  const request = makeRequest(storeId);
  const results = await Promise.all([
    reservePrepaidRenewalPixAttempt({ storeId, proposalId, request }),
    reservePrepaidRenewalPixAttempt({ storeId, proposalId, request }),
  ]);
  assert.deepEqual(results.map(result => result.action).sort(), ['create', 'reuse']);
  const snapshot = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.get('requestDigest'),
    createHash('sha256').update(request.init.body).digest('hex'));
});

test('Firestore emulator: conflicting payload cannot overwrite a reserved attempt', async () => {
  const storeId = 'renew-pix-emulator-conflict';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const altered = {
    ...request,
    init: { ...request.init, body: request.init.body.replace('299.9', '199.9') },
  };
  await assert.rejects(
    reservePrepaidRenewalPixAttempt({ storeId, proposalId, request: altered }),
    /RENEWAL_PIX_ATTEMPT_INVALID/,
  );
  const snapshot = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(snapshot.get('requestDigest'),
    createHash('sha256').update(request.init.body).digest('hex'));
});

test('Firestore emulator: another store cannot reserve against missing acceptance', async () => {
  const storeId = 'renew-pix-emulator-tenant-a';
  await seed(storeId);
  await assert.rejects(
    reservePrepaidRenewalPixAttempt({
      storeId: 'renew-pix-emulator-tenant-b', proposalId, request: makeRequest(storeId),
    }),
    /RENEWAL_PIX_ACCEPTANCE_REQUIRED/,
  );
  assert.equal((await adminDb.doc(
    `stores/renew-pix-emulator-tenant-b/prepaidRenewalPixAttempts/${proposalId}`
  ).get()).exists, false);
});
