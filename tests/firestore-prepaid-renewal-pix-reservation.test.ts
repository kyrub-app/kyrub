import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import { reservePrepaidRenewalPixAttempt } from '../server/payments/prepaidRenewalPixAttemptReservation.js';
import { bindVerifiedPrepaidRenewalPixCreation } from '../server/payments/prepaidRenewalPixVerifiedCreationBinding.js';
import { bindCreatedPrepaidRenewalPixPaymentId } from '../server/payments/prepaidRenewalPixPaymentIdBinding.js';
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

test('Firestore emulator: Pix provider ID binding is immutable and idempotent', async () => {
  const storeId = 'renew-pix-emulator-payment-binding';
  await seed(storeId);
  const request = makeRequest(storeId);
  await reservePrepaidRenewalPixAttempt({ storeId, proposalId, request });
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
      expectedCollectorId: '987654', trustedProviderPayment,
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
    storeId, proposalId, request, expectedCollectorId: '987654',
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
      assert.match(path, /^\/v1\/payments\/search\?/);
      calls.push(init.method);
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
  assert.deepEqual(calls, ['GET', 'GET']);
  const ref = adminDb.doc(`stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`);
  assert.equal((await ref.get()).get('providerPaymentId'), '777777');
  assert.equal((await ref.get()).get('executionState'), 'outcome_unknown');
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
