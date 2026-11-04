import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { reservePrepaidRenewalPixAttempt } from '../server/payments/prepaidRenewalPixAttemptReservation.js';
import { bindVerifiedPrepaidRenewalPixCreation } from '../server/payments/prepaidRenewalPixVerifiedCreationBinding.js';
import { bindCreatedPrepaidRenewalPixPaymentId } from '../server/payments/prepaidRenewalPixPaymentIdBinding.js';
import { claimPrepaidRenewalPixExecution } from '../server/payments/prepaidRenewalPixExecutionClaim.js';
import { buildPrepaidRenewalPixRequest } from '../server/payments/prepaidRenewalPixRequest.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('RENEWAL_PIX_RESERVATION_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';

const proposalId = 'b'.repeat(64);
const acceptedAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.parse(acceptedAt) + 30 * 60_000).toISOString();
const seed = async (storeId: string) => {
  // Emulator-only merchant identity and OAuth metadata: no token or live credentials.
  await adminDb.doc(`stores/${storeId}`).set({ ownerId: storeId, legacyTenantId: storeId }, { merge: true });
  await adminDb.doc(`stores/${storeId}/paymentProviderConnections/mercado_pago`).set({
    provider: 'mercado_pago', storeId, status: 'connected', externalAccountId: '987654',
  });
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

test('Firestore emulator: Pix provider ID binding is immutable and idempotent', async () => {
  const storeId = 'renew-pix-emulator-payment-binding';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await assert.rejects(bindCreatedPrepaidRenewalPixPaymentId({ storeId, proposalId, paymentId: '123456', expectedRequestDigest: digest }), /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  assert.equal(await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest }), 'claimed');
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const bind = (paymentId: string, digest = expectedRequestDigest) =>
    bindCreatedPrepaidRenewalPixPaymentId({
      storeId, proposalId, paymentId, expectedRequestDigest: digest,
    });
  assert.equal(await bind('123456'), 'bound');
  assert.equal(await bind('123456'), 'already_bound');
  await assert.rejects(bind('654321'), /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  await assert.rejects(bind('123456', '0'.repeat(64)), /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('providerPaymentId'), '123456');
  await assert.rejects(
    bindCreatedPrepaidRenewalPixPaymentId({
      storeId: 'another-store', proposalId, paymentId: '123456', expectedRequestDigest,
    }),
    /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/,
  );
});

test('Firestore emulator: concurrent distinct provider IDs cannot replace the first binding', async () => {
  const storeId = 'renew-pix-emulator-binding-race';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  assert.equal(await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest }), 'claimed');
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const ids = ['100001', '100002'];
  const outcomes = await Promise.allSettled(ids.map(paymentId =>
    bindCreatedPrepaidRenewalPixPaymentId({
      storeId, proposalId, paymentId, expectedRequestDigest,
    })
  ));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  const winnerIndex = outcomes.findIndex(result => result.status === 'fulfilled');
  const loser = outcomes.find(result => result.status === 'rejected');
  assert.match(String(loser?.status === 'rejected' ? loser.reason : ''),
    /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('providerPaymentId'), ids[winnerIndex]);
});

test('Firestore emulator: validated provider creation response binds once and rejects forged seller', async () => {
  const storeId = 'renew-pix-emulator-verified-creation';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  assert.equal(await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest }), 'claimed');
  const body = JSON.parse(request.init.body) as Record<string, unknown>;
  const response = {
    id: 321654, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const bind = (trustedProviderResponse: unknown) =>
    bindVerifiedPrepaidRenewalPixCreation({
      storeId, proposalId, expectedCollectorId: '987654',
      request, trustedProviderResponse,
    });
  await assert.rejects(bind({ ...response, collector_id: 123 }),
    /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('providerPaymentId'), undefined);
  assert.deepEqual(await bind(response), { paymentId: '321654', action: 'bound' });
  assert.deepEqual(await bind(response), { paymentId: '321654', action: 'already_bound' });
  await assert.rejects(bind({ ...response, id: 321655 }),
    /RENEWAL_PIX_PAYMENT_BINDING_CONFLICT/);
  assert.equal((await ref.get()).get('providerPaymentId'), '321654');
});

test('Firestore emulator: concurrent identical provider IDs bind once and remain idempotent', async () => {
  const storeId = 'renew-pix-emulator-identical-binding-race';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  assert.equal(await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest }), 'claimed');
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const bind = () => bindCreatedPrepaidRenewalPixPaymentId({
    storeId, proposalId, paymentId: '200001', expectedRequestDigest,
  });
  const results = await Promise.all([bind(), bind(), bind()]);
  assert.deepEqual(results.sort(), ['already_bound', 'already_bound', 'bound']);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('providerPaymentId'), '200001');
});

test('Firestore emulator: concurrent execution claims allow only one unbound Pix POST owner', async () => {
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-execution-claim';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const claim = () => claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest });
  const results = await Promise.allSettled([claim(), claim(), claim()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 2);
  assert.equal(results.find(result => result.status === 'fulfilled')?.value, 'claimed');
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.match(String(result.reason), /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
    }
  }
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('executionState'), 'in_flight');
  await markPrepaidRenewalPixExecutionOutcomeUnknown({
    storeId, proposalId, expectedRequestDigest,
  });
  assert.equal((await ref.get()).get('executionState'), 'outcome_unknown');
  await assert.rejects(claim(), /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  await assert.rejects(claimPrepaidRenewalPixExecution({
    storeId, proposalId, expectedRequestDigest: '0'.repeat(64),
  }), /RENEWAL_PIX_EXECUTION_GATE_CONFLICT/);
});

test('Firestore emulator: legacy Pix attempt without gate state cannot initiate a new POST', async () => {
  const { claimPrepaidRenewalPixExecution } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-legacy-gate';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('executionState'), 'idle');
  await ref.update({ executionState: (await import('firebase-admin/firestore')).FieldValue.delete() });
  await assert.rejects(claimPrepaidRenewalPixExecution({
    storeId, proposalId,
    expectedRequestDigest: createHash('sha256').update(request.init.body).digest('hex'),
  }), /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  assert.equal((await ref.get()).get('executionState'), undefined);
});

test('Firestore emulator: already-bound legacy attempt permits GET-only recovery', async () => {
  const { claimPrepaidRenewalPixExecution } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-legacy-bound-gate';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  await ref.update({
    executionState: (await import('firebase-admin/firestore')).FieldValue.delete(),
    providerPaymentId: '987654',
  });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  assert.equal(await claimPrepaidRenewalPixExecution({
    storeId, proposalId, expectedRequestDigest,
  }), 'fetch_bound');
  assert.equal((await ref.get()).get('executionState'), undefined);
  assert.equal((await ref.get()).get('providerPaymentId'), '987654');
});

test('Firestore emulator: locked seller-scoped executor permits only one concurrent Pix POST', async () => {
  const { executeLockedIsolatedPrepaidRenewalPix } =
    await import('../server/payments/prepaidRenewalPixLockedExecution.js');
  const storeId = 'renew-pix-emulator-locked-executor';
  await seed(storeId);
  const request = makeRequest(storeId);
  const requestBody = JSON.parse(request.init.body);
  let postCount = 0;
  const execute = () => executeLockedIsolatedPrepaidRenewalPix({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId,
    oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654',
    oauthExternalAccountId: '987654',
    reserve: async () => reservePrepaidRenewalPixAttempt({ storeId, proposalId, request }),
    bindPayment: async paymentId => bindCreatedPrepaidRenewalPixPaymentId({
      storeId, proposalId, paymentId,
      expectedRequestDigest: createHash('sha256').update(request.init.body).digest('hex'),
    }),
    sellerScopedRequest: async (_scope, path, init) => {
      assert.equal(path, '/v1/payments');
      assert.equal(init.method, 'POST');
      postCount++;
      return {
        id: 123456, status: 'pending', payment_method_id: 'pix',
        currency_id: 'BRL', collector_id: 987654,
        transaction_amount: requestBody.transaction_amount,
        external_reference: requestBody.external_reference,
      };
    },
  });
  const outcomes = await Promise.allSettled([execute(), execute(), execute()]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 2);
  assert.equal(postCount, 1);
  const attemptRef = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await attemptRef.get()).get('providerPaymentId'), '123456');
});

test('Firestore emulator: unknown Pix outcome reconciles once with verified seller payment', async () => {
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-reconcile';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  assert.equal(await claimPrepaidRenewalPixExecution(locator), 'claimed');
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 567890, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const reconcile = (trustedProviderPayment: unknown, targetStore = storeId) =>
    reconcileUnknownPrepaidRenewalPixPayment({
      storeId: targetStore, proposalId, request,
      expectedCollectorId: '987654', trustedProviderPayment, sellerAuthority: { credentialScopeId: targetStore, externalAccountId: '987654' },
    });
  await assert.rejects(reconcile({ ...payment, collector_id: 123 }),
    /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  await assert.rejects(reconcile({ ...payment, transaction_amount: 0 }),
    /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  await assert.rejects(reconcile(payment, 'other-store'),
    /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH|RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  const outcomes = await Promise.all([reconcile(payment), reconcile(payment), reconcile(payment)]);
  assert.deepEqual(outcomes.sort(), ['already_bound', 'already_bound', 'bound']);
  await assert.rejects(reconcile({ ...payment, id: 567891 }),
    /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('providerPaymentId'), '567890');
  assert.equal((await ref.get()).get('executionState'), 'outcome_unknown');
  assert.equal(await claimPrepaidRenewalPixExecution(locator), 'fetch_bound');
});

test('Firestore emulator: reconciliation refuses idle attempt and leaves it unchanged', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-reconcile-idle';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    expectedCollectorId: '987654',
    trustedProviderPayment: {
      id: 567890, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('providerPaymentId'), undefined);
  assert.equal((await ref.get()).get('executionState'), 'idle');
});

test('Firestore emulator: legacy primary store allows guarded Pix binding without top-level store', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-legacy-primary';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  await adminDb.doc(`users/${storeId}/stores/${storeId}`).set({
    id: storeId, ownerId: storeId, legacyTenantId: storeId,
  });
  await adminDb.doc(`stores/${storeId}`).delete();
  const body = JSON.parse(request.init.body);
  const result = await reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '987654',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777779, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  });
  assert.equal(result, 'bound');
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), '777779');
});

test('Firestore emulator: legacy owner mismatch rejects guarded Pix binding', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-legacy-owner-mismatch';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  await adminDb.doc(`users/${storeId}/stores/${storeId}`).set({
    id: storeId, ownerId: 'different-owner', legacyTenantId: storeId,
  });
  await adminDb.doc(`stores/${storeId}`).delete();
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '987654',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777780, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: changed seller account rejects transactional Pix binding', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-transaction-account-rotation';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  await adminDb.doc(`stores/${storeId}/paymentProviderConnections/mercado_pago`).update({
    externalAccountId: '123456',
  });
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '987654',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777781, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: disconnected seller rejects transactional Pix binding', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-transaction-disconnected';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  await adminDb.doc(`stores/${storeId}/paymentProviderConnections/mercado_pago`).update({
    status: 'disconnected',
  });
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '987654',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777782, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: changed canonical store owner rejects transactional Pix binding', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-transaction-owner-rotation';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  await adminDb.doc(`stores/${storeId}`).update({ ownerId: 'new-owner' });
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '987654',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777783, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: missing or invalid runtime seller authority cannot bind Pix', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-invalid-seller-authority';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  const body = JSON.parse(request.init.body);
  const base = {
    storeId, proposalId, request, expectedCollectorId: '987654',
    trustedProviderPayment: {
      id: 777784, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  };
  for (const sellerAuthority of [
    undefined,
    { credentialScopeId: '../foreign', externalAccountId: '987654' },
    { credentialScopeId: storeId, externalAccountId: 'not-numeric' },
  ]) {
    await assert.rejects(
      reconcileUnknownPrepaidRenewalPixPayment({
        ...base,
        sellerAuthority: sellerAuthority as { credentialScopeId: string; externalAccountId: string },
      }),
      /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/,
    );
  }
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: expected collector must match transactional seller account', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-collector-seller-mismatch';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '123456',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777785, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 123456,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: legacy primary store with foreign tenant scope cannot bind Pix', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const storeId = 'renew-pix-emulator-legacy-foreign-scope';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const digest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest: digest });
  await adminDb.doc(`users/${storeId}/stores/${storeId}`).set({
    id: storeId, ownerId: storeId, legacyTenantId: 'foreign-tenant',
  });
  await adminDb.doc(`stores/${storeId}`).delete();
  const body = JSON.parse(request.init.body);
  await assert.rejects(reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, expectedCollectorId: '987654',
    sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    trustedProviderPayment: {
      id: 777786, status: 'pending', payment_method_id: 'pix',
      currency_id: 'BRL', collector_id: 987654,
      transaction_amount: body.transaction_amount,
      external_reference: body.external_reference,
    },
  }), /RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED/);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'in_flight');
});

test('Firestore emulator: seller GET reconciliation binds payment without POST', async () => {
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const storeId = 'renew-pix-emulator-seller-reconcile';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest });
  await markPrepaidRenewalPixExecutionOutcomeUnknown({ storeId, proposalId, expectedRequestDigest });
  const body = JSON.parse(request.init.body);
  const calls: string[] = [];
  const reconcile = () => reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (scope, path, init) => {
      assert.equal(scope, storeId);
      assert.equal(init.method, 'GET');
      calls.push(path);
      const selected = {
        id: 777777, status: 'pending', payment_method_id: 'pix',
        currency_id: 'BRL', collector_id: 987654,
        transaction_amount: body.transaction_amount,
        external_reference: body.external_reference,
      };
      if (path === '/v1/payments/777777') return selected;
      assert.match(path, /^\/v1\/payments\/search\?/);
      return {
        paging: { total: 1, limit: 50, offset: 0 },
        results: [{
          id: 777777, status: 'pending', payment_method_id: 'pix',
          currency_id: 'BRL', collector_id: 987654,
          transaction_amount: body.transaction_amount,
          external_reference: body.external_reference,
        }],
      };
    },
  });
  assert.equal(await reconcile(), 'bound');
  assert.equal(await reconcile(), 'already_bound');
  assert.deepEqual(calls.map(path => path.startsWith('/v1/payments/search?') ? 'search' : 'detail'),
    ['search', 'detail', 'search', 'detail']);
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('providerPaymentId'), '777777');
  assert.equal((await ref.get()).get('executionState'), 'outcome_unknown');
});

test('Firestore emulator: rotated or disconnected seller prevents reconciliation GET and keeps Pix locked', async () => {
  const { markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const storeId = 'renew-pix-emulator-seller-rotation';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest });
  await markPrepaidRenewalPixExecutionOutcomeUnknown({ storeId, proposalId, expectedRequestDigest });
  let providerCalls = 0;
  const run = () => reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async () => { providerCalls++; throw new Error('UNEXPECTED_PROVIDER_CALL'); },
  });
  const connection = adminDb.doc(`stores/${storeId}/paymentProviderConnections/mercado_pago`);
  await connection.update({ externalAccountId: '123456' });
  await assert.rejects(run(), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  assert.equal(providerCalls, 0);
  await connection.update({ status: 'disconnected', externalAccountId: '' });
  await assert.rejects(run(), /COMMERCIAL_RECIPIENT_STORE_PAYMENT_NOT_CONNECTED/);
  assert.equal(providerCalls, 0);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
  await assert.rejects(
    claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest }),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/,
  );
});

test('Firestore emulator: seller account rotates between GET and final Pix binding', async () => {
  const { markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const storeId = 'renew-pix-emulator-mid-get-rotation';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest });
  await markPrepaidRenewalPixExecutionOutcomeUnknown({ storeId, proposalId, expectedRequestDigest });
  const body = JSON.parse(request.init.body);
  const connection = adminDb.doc(`stores/${storeId}/paymentProviderConnections/mercado_pago`);
  const payment = {
    id: 777777, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const calls: string[] = [];
  await assert.rejects(
    reconcileUnknownSellerPrepaidRenewalPixPayment({
      storeId, proposalId, request,
      trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
      trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
      sellerScopedRequest: async (_scope, path, init) => {
        assert.equal(init.method, 'GET');
        calls.push(path);
        if (path === '/v1/payments/777777') {
          await connection.update({ externalAccountId: '123456' });
          return payment;
        }
        assert.match(path, /^\/v1\/payments\/search\?/);
        return { paging: { total: 1, limit: 50, offset: 0 }, results: [payment] };
      },
    }),
    /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/,
  );
  assert.equal(calls.length, 2);
  const attempt = await adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), undefined);
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  await assert.rejects(
    claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest }),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/,
  );
});

test('Firestore emulator: seller reconciliation preflight blocks missing, idle and altered attempts before GET', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-preflight';
  await seed(storeId);
  const request = makeRequest(storeId);
  let getCount = 0;
  const run = (candidate = request) => reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request: candidate,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async () => { getCount++; throw new Error('UNEXPECTED_PROVIDER_GET'); },
  });
  await assert.rejects(run(), /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  await assert.rejects(run(), /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest });
  const altered = {
    ...request,
    init: { ...request.init, body: request.init.body + ' ' },
  };
  await assert.rejects(run(altered), /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  assert.equal(getCount, 0);
  assert.equal((await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get()).get('providerPaymentId'), undefined);
});

test('Firestore emulator: failed seller GET reconciliation never unlocks a second Pix POST', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-failed-get';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  let getCount = 0;
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      getCount++;
      assert.equal(init.method, 'GET');
      assert.match(path, /^\/v1\/payments\/search\?/);
      throw new Error('SIMULATED_PROVIDER_TIMEOUT');
    },
  }), /SIMULATED_PROVIDER_TIMEOUT/);
  assert.equal(getCount, 1);
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: empty seller search cannot reset unknown outcome or authorize another POST', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-empty-search';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  let getCount = 0;
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      getCount++;
      assert.equal(init.method, 'GET');
      assert.match(path, /^\/v1\/payments\/search\?/);
      return { paging: { total: 0, offset: 0, limit: 50 }, results: [] };
    },
  }), /RENEWAL_PIX_RECONCILIATION_NOT_FOUND_UNRESOLVED/);
  assert.equal(getCount, 1);
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: ambiguous seller payments never bind or unlock Pix execution', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-ambiguous-search';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 890001, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  let getCount = 0;
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      getCount++;
      assert.equal(init.method, 'GET');
      assert.match(path, /^\/v1\/payments\/search\?/);
      return {
        paging: { total: 2, offset: 0, limit: 50 },
        results: [payment, { ...payment, id: 890002 }],
      };
    },
  }), /RENEWAL_PIX_RECONCILIATION_AMBIGUOUS/);
  assert.equal(getCount, 1);
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: unstable seller search pagination never binds or unlocks Pix', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-unstable-pages';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  let getCount = 0;
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      getCount++;
      assert.equal(init.method, 'GET');
      const offset = Number(new URL('https://test.invalid' + path).searchParams.get('offset'));
      const total = offset === 0 ? 51 : 52;
      return {
        paging: { total, offset, limit: 50 },
        results: offset === 0
          ? Array.from({ length: 50 }, (_, i) => ({
              id: 300000 + i, status: 'pending', payment_method_id: 'pix',
              currency_id: 'BRL', collector_id: 999999,
              transaction_amount: body.transaction_amount,
              external_reference: body.external_reference,
            }))
          : [{
              id: 890003, status: 'pending', payment_method_id: 'pix',
              currency_id: 'BRL', collector_id: 987654,
              transaction_amount: body.transaction_amount,
              external_reference: body.external_reference,
            }],
      };
    },
  }), /RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE/);
  assert.equal(getCount, 2);
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: repeated payment across stable-total pages keeps Pix unresolved', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-shifting-pages';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  let getCount = 0;
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      getCount++;
      assert.equal(init.method, 'GET');
      const offset = Number(new URL('https://test.invalid' + path).searchParams.get('offset'));
      const base = {
        status: 'pending', payment_method_id: 'pix', currency_id: 'BRL',
        collector_id: 987654, transaction_amount: body.transaction_amount,
        external_reference: body.external_reference,
      };
      return {
        paging: { total: 51, offset, limit: 50 },
        results: offset === 0
          ? Array.from({ length: 50 }, (_, i) => ({
              ...base, id: 400000 + i, collector_id: 999999,
            }))
          : [{ ...base, id: 400049 }],
      };
    },
  }), /RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE/);
  assert.equal(getCount, 2);
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: seller payment detail mismatch cannot bind searched payment', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-detail-mismatch';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 890004, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const calls: string[] = [];
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      calls.push(path);
      assert.equal(init.method, 'GET');
      if (path === '/v1/payments/890004') return { ...payment, collector_id: 999999 };
      assert.match(path, /^\/v1\/payments\/search\?/);
      return { paging: { total: 1, offset: 0, limit: 50 }, results: [payment] };
    },
  }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], '/v1/payments/890004');
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: seller payment detail amount mismatch cannot bind searched payment', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-detail-amount';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 890005, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const calls: string[] = [];
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      calls.push(path);
      assert.equal(init.method, 'GET');
      if (path === '/v1/payments/890005') return { ...payment, transaction_amount: body.transaction_amount + 1 };
      assert.match(path, /^\/v1\/payments\/search\?/);
      return { paging: { total: 1, offset: 0, limit: 50 }, results: [payment] };
    },
  }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], '/v1/payments/890005');
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: seller payment detail GET timeout keeps unknown payment locked', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-detail-timeout';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 890006, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const calls: string[] = [];
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      calls.push(path);
      assert.equal(init.method, 'GET');
      if (path === '/v1/payments/890006') throw new Error('SELLER_PAYMENT_DETAIL_TIMEOUT');
      assert.match(path, /^\/v1\/payments\/search\?/);
      return { paging: { total: 1, offset: 0, limit: 50 }, results: [payment] };
    },
  }), /SELLER_PAYMENT_DETAIL_TIMEOUT/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], '/v1/payments/890006');
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: seller payment detail different ID cannot bind searched payment', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-detail-id';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 890007, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const calls: string[] = [];
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      calls.push(path);
      assert.equal(init.method, 'GET');
      if (path === '/v1/payments/890007') return { ...payment, id: 890008 };
      assert.match(path, /^\/v1\/payments\/search\?/);
      return { paging: { total: 1, offset: 0, limit: 50 }, results: [payment] };
    },
  }), /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], '/v1/payments/890007');
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: seller payment detail foreign tenant metadata cannot bind searched payment', async () => {
  const { reconcileUnknownSellerPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixSellerReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-detail-tenant';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const payment = {
    id: 890009, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const calls: string[] = [];
  await assert.rejects(reconcileUnknownSellerPrepaidRenewalPixPayment({
    storeId, proposalId, request,
    trustedCredentialScopeId: storeId, oauthCredentialScopeId: storeId,
    trustedExternalAccountId: '987654', oauthExternalAccountId: '987654',
    sellerScopedRequest: async (_scope, path, init) => {
      calls.push(path);
      assert.equal(init.method, 'GET');
      if (path === '/v1/payments/890009') return { ...payment, metadata: { kyrub_store_id: 'foreign-store', kyrub_prepaid_renewal_proposal_id: proposalId } };
      assert.match(path, /^\/v1\/payments\/search\?/);
      return { paging: { total: 1, offset: 0, limit: 50 }, results: [payment] };
    },
  }), /RENEWAL_PIX_CREATION_RESPONSE_MISMATCH/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], '/v1/payments/890009');
  await assert.rejects(claimPrepaidRenewalPixExecution(locator),
    /RENEWAL_PIX_EXECUTION_OUTCOME_UNRESOLVED/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  assert.equal(attempt.get('providerPaymentId'), undefined);
});

test('Firestore emulator: concurrent reconciliation cannot bind conflicting payment IDs', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-conflicting-ids';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  await claimPrepaidRenewalPixExecution({ storeId, proposalId, expectedRequestDigest });
  await markPrepaidRenewalPixExecutionOutcomeUnknown({ storeId, proposalId, expectedRequestDigest });
  const body = JSON.parse(request.init.body);
  const payment = {
    status: 'pending', payment_method_id: 'pix', currency_id: 'BRL',
    collector_id: 987654, transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const reconcile = (id: number) => reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    expectedCollectorId: '987654',
    trustedProviderPayment: { ...payment, id },
  });
  const results = await Promise.allSettled([reconcile(890011), reconcile(890012)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.match(String(rejected && rejected.status === 'rejected' && rejected.reason),
    /RENEWAL_PIX_RECONCILIATION_CONFLICT/);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.ok(['890011', '890012'].includes(attempt.get('providerPaymentId')));
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
});

test('Firestore emulator: concurrent same-ID reconciliation is idempotent and remains locked', async () => {
  const { reconcileUnknownPrepaidRenewalPixPayment } =
    await import('../server/payments/prepaidRenewalPixReconciliation.js');
  const { claimPrepaidRenewalPixExecution, markPrepaidRenewalPixExecutionOutcomeUnknown } =
    await import('../server/payments/prepaidRenewalPixExecutionClaim.js');
  const storeId = 'renew-pix-emulator-reconcile-same-id';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
  const expectedRequestDigest = createHash('sha256').update(request.init.body).digest('hex');
  const locator = { storeId, proposalId, expectedRequestDigest };
  await claimPrepaidRenewalPixExecution(locator);
  await markPrepaidRenewalPixExecutionOutcomeUnknown(locator);
  const body = JSON.parse(request.init.body);
  const trustedProviderPayment = {
    id: 890013, status: 'pending', payment_method_id: 'pix',
    currency_id: 'BRL', collector_id: 987654,
    transaction_amount: body.transaction_amount,
    external_reference: body.external_reference,
  };
  const reconcile = () => reconcileUnknownPrepaidRenewalPixPayment({
    storeId, proposalId, request, sellerAuthority: { credentialScopeId: storeId, externalAccountId: '987654' },
    expectedCollectorId: '987654',
    trustedProviderPayment,
  });
  const results = await Promise.all([reconcile(), reconcile()]);
  assert.deepEqual(results.sort(), ['already_bound', 'bound']);
  const attempt = await adminDb.doc(
    `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`
  ).get();
  assert.equal(attempt.get('providerPaymentId'), '890013');
  assert.equal(attempt.get('executionState'), 'outcome_unknown');
  // A bound payment is recoverable by GET only; the execution gate never
  // returns 'claimed' again, so a second provider POST remains prohibited.
  assert.equal(await claimPrepaidRenewalPixExecution(locator), 'fetch_bound');
});

test('Authenticated Pix checkout recipient guard rejects substituted OAuth seller identity', async () => {
  const { assertAuthenticatedPrepaidRenewalPixRecipient } =
    await import('../server/payments/prepaidRenewalPixLockedExecution.js');
  const recipient = { credentialScopeId: 'owner-verified', externalAccountId: '987654' };
  assert.doesNotThrow(() => assertAuthenticatedPrepaidRenewalPixRecipient({
    recipient, trustedCredentialScopeId: 'owner-verified', trustedExternalAccountId: '987654',
  }));
  for (const identity of [
    { trustedCredentialScopeId: 'owner-foreign', trustedExternalAccountId: '987654' },
    { trustedCredentialScopeId: 'owner-verified', trustedExternalAccountId: '123456' },
    { trustedCredentialScopeId: 'owner-foreign', trustedExternalAccountId: '123456' },
  ]) {
    assert.throws(() => assertAuthenticatedPrepaidRenewalPixRecipient({
      recipient, ...identity,
    }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
  }
  assert.throws(() => assertAuthenticatedPrepaidRenewalPixRecipient({
    recipient: { credentialScopeId: '', externalAccountId: '987654' },
    trustedCredentialScopeId: '', trustedExternalAccountId: '987654',
  }), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
});
