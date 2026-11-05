import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createSubscriptionRenewalProposal } from '../shared/subscriptionContractRenewal.js';

const storeId = 'store-a';
const proposalId = 'a'.repeat(64);
const buyerId = 'buyer-a';
const proposal = createSubscriptionRenewalProposal({
  contractId: 'old-contract', storeId, customerId: buyerId,
  productId: 'subscription', months: 3, monthlyBasePriceMinor: 10000,
  discountPercent: 0, totalPaidMinor: 30000,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
}, 12000);
const acceptedAt = '2026-11-01T10:00:00.000Z';
const acceptance = { customerId: buyerId, storeId, acceptedTotalMinor: proposal.totalDueMinor, acceptedAt };
const reference = `kyrub:prepaid-renewal:${storeId}:${proposalId}`;
const makeData = () => ({
  status: 'accepted', acceptedBy: buyerId, proposal, acceptance, acceptedAt,
  createdAt: '2026-11-01T09:00:00.000Z',
  acceptedProposalDigest: createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),
  sellerCredentialScopeId: storeId, paymentExternalReference: reference,
});
let data: Record<string, unknown> = makeData();
let authenticatedUid = buyerId;
let paymentFailure = false;
let reservationMissing = false;
let boundPaymentId = '12345';
let providerApprovedAt = '2026-11-01T11:00:00.000Z';
let providerSideEffect: (() => void) | null = null;
const calls: string[] = [];
const persistedInputs: unknown[][] = [];

const bundled = await build({
  entryPoints: ['server/payments/prepaidRenewalActivation.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'isolate-renewal-boundaries',
    setup(plugin) {
      plugin.onResolve({ filter: /firebaseAdmin\.js$|prepaidRenewalPaymentVerification\.js$|consultantAuth\.js$|persistedPrepaidRenewal\.js$|commercialRecipientAuthorityService\.js$|prepaidRenewalRecipientBinding\.js$/ }, args =>
        ({ path: args.path, namespace: 'renewal-isolated' }));
      plugin.onLoad({ filter: /.*/, namespace: 'renewal-isolated' }, args => {
        let contents = '';
        if (args.path.endsWith('commercialRecipientAuthorityService.js')) contents = `
          export const resolveCommercialRecipientAuthority = async () => ({
            context: 'store_subscription', recipientKind: 'merchant_store',
            credentialAuthority: 'store_oauth_vault', canonicalStoreId: 'store-a',
            ownerUserId: 'owner-a', credentialScopeId: 'owner-a', externalAccountId: '12345',
          });
        `;
        if (args.path.endsWith('prepaidRenewalRecipientBinding.js')) contents = `
          export const resolvePrepaidRenewalRecipientBinding = input => {
            if (input.storedSellerCredentialScopeId !== 'store-a') throw new Error('RENEWAL_RECIPIENT_AUTHORITY_MISMATCH');
            return { credentialScopeId: 'owner-a', externalAccountId: '12345' };
          };
        `;
        if (args.path.endsWith('firebaseAdmin.js')) contents = `
          export const adminDb = { doc: path => ({
            get: async () => globalThis.__renewalIntegratedMock('get', path),
          }) };
        `;
        if (args.path.endsWith('consultantAuth.js')) contents = `
          export const authenticateConsultantRequest = async token =>
            globalThis.__renewalIntegratedMock('auth', token);
        `;
        if (args.path.endsWith('prepaidRenewalPaymentVerification.js')) contents = `
          export const verifyPrepaidRenewalMercadoPagoPayment = async input =>
            globalThis.__renewalIntegratedMock('provider', input);
        `;
        if (args.path.endsWith('persistedPrepaidRenewal.js')) contents = `
          export const persistVerifiedPrepaidRenewal = async (...args) =>
            globalThis.__renewalIntegratedMock('persist', args);
        `;
        return { contents, loader: 'js' };
      });
    },
  }],
});
const { recordPrepaidRenewalWithVerifiedSources } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
(globalThis as typeof globalThis & { __renewalIntegratedMock?: (name: string, value: unknown) => unknown })
  .__renewalIntegratedMock = (name, value) => {
    calls.push(name);
    if (name === 'auth') {
      if (value !== 'Bearer valid') throw new Error('AUTH_REQUIRED');
      return { uid: authenticatedUid };
    }
    if (name === 'get') {
      const path = String(value);
      if (path.endsWith('/prepaidRenewalPixAttempts/' + proposalId)) return {
        exists: !reservationMissing, data: () => ({
          storeId, proposalId, status: 'reserved',
          idempotencyKey: `prepaid-renewal-${proposalId}`,
          providerPaymentId: boundPaymentId,
          requestDigest: 'b'.repeat(64),
          expiresAt: new Date(Date.parse(acceptedAt) + 30 * 60_000).toISOString(),
        }),
      };
      if (path.endsWith('/prepaidRenewalProposals/' + proposalId))
        return { exists: true, data: () => data };
      if (path.endsWith('/subscriptions/canonical-subscription')) return {
        exists: true,
        data: () => ({ id: 'canonical-subscription', storeId, buyerId, productId: 'subscription' }),
      };
      if (path.endsWith('/prepaidSubscriptionContracts/old-contract'))
        return { exists: true,
          data: () => ({ storeId, contractId: 'old-contract', customerId: buyerId,
            productId: 'subscription', subscriptionId: 'canonical-subscription' }),
          get: (field: string) => ({
            storeId, contractId: 'old-contract', customerId: buyerId,
            productId: 'subscription', subscriptionId: 'canonical-subscription',
            months: 3, expiresAt: '2027-01-01T00:00:00.000Z',
          } as Record<string, unknown>)[field],
        };
      throw new Error('UNEXPECTED_DOC:' + path);
    }
    if (name === 'provider') {
      if (paymentFailure) throw new Error('RENEWAL_PROVIDER_PAYMENT_MISMATCH');
      providerSideEffect?.();
      const input = value as Record<string, unknown>;
      assert.equal(input.sellerCredentialScopeId, 'owner-a');
      assert.equal(input.expectedExternalReference, reference);
      assert.equal(input.expectedAmountMinor, proposal.totalDueMinor);
      return {
        id: '12345', status: 'approved', amountMinor: proposal.totalDueMinor,
        occurredAt: providerApprovedAt, verifiedByProvider: true,
      };
    }
    if (name === 'persist') { persistedInputs.push(value as unknown[]); return 'created'; }
    throw new Error('UNEXPECTED_CALL:' + name);
  };
const request = { authorization: 'Bearer valid', storeId, proposalId, paymentId: '12345' };
const reset = () => {
  calls.length = 0; persistedInputs.length = 0; data = makeData(); authenticatedUid = buyerId; paymentFailure = false; reservationMissing = false; boundPaymentId = '12345'; providerApprovedAt = '2026-11-01T11:00:00.000Z'; providerSideEffect = null;
};

test('integrated renewal: unauthenticated request never reaches Firestore or payment provider', async () => {
  reset();
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources({ ...request, authorization: '' }), /AUTH_REQUIRED/);
  assert.deepEqual(calls, ['auth']);
});

test('integrated renewal: wrong buyer cannot reach payment provider', async () => {
  reset(); authenticatedUid = 'another-buyer';
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources(request), /RENEWAL_ACCEPTANCE_REQUIRED/);
  assert.deepEqual(calls, ['auth', 'get']);
});

test('integrated renewal: altered checkout binding blocks provider lookup', async () => {
  reset(); data = { ...data, sellerCredentialScopeId: 'other-store' };
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources(request), /RENEWAL_RECIPIENT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, ['auth', 'get', 'get']);
});

test('integrated renewal: provider rejection never persists a successor', async () => {
  reset(); paymentFailure = true;
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources(request), /RENEWAL_PROVIDER_PAYMENT_MISMATCH/);
  assert.deepEqual(calls, ['auth', 'get', 'get', 'provider']);
});

test('integrated renewal: verified payment reaches successor persistence only after checks', async () => {
  reset();
  const result = await recordPrepaidRenewalWithVerifiedSources(request);
  assert.equal(result, 'created');
  assert.deepEqual(calls, ['auth', 'get', 'get', 'provider', 'get', 'get', 'get', 'get', 'persist']);
});

test('integrated renewal: verified payment without a Pix reservation never persists', async () => {
  reset();
  reservationMissing = true;
  await assert.rejects(
    recordPrepaidRenewalWithVerifiedSources(request),
    /RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH/,
  );
  assert.equal(calls.includes('provider'), true);
  assert.equal(calls.includes('persist'), false);
  assert.equal(persistedInputs.length, 0);
});

test('integrated renewal: payment not bound to the accepted Pix attempt never creates contract', async () => {
  reset();
  boundPaymentId = '99999';
  await assert.rejects(
    recordPrepaidRenewalWithVerifiedSources(request),
    /RENEWAL_PIX_PAYMENT_ATTEMPT_MISMATCH/,
  );
  assert.equal(calls.includes('provider'), true);
  assert.equal(calls.includes('persist'), false);
  assert.equal(persistedInputs.length, 0);
});

test('integrated renewal: acceptance changed during provider lookup never persists', async () => {
  reset();
  providerSideEffect = () => {
    data = { ...data, acceptance: { ...acceptance, acceptedAt: '2026-11-01T10:30:00.000Z' } };
  };
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources(request), /RENEWAL_ACCEPTANCE_REQUIRED|RENEWAL_ACCEPTANCE_CHANGED/);
  assert.equal(calls.includes('persist'), false);
});

test('integrated renewal: checkout binding changed during provider lookup never persists', async () => {
  reset();
  providerSideEffect = () => { data = { ...data, paymentExternalReference: 'replaced-reference' }; };
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources(request), /RENEWAL_CHECKOUT_BINDING_MISSING/);
  assert.equal(calls.includes('persist'), false);
});

test('integrated renewal: server-generated successor ID is deterministic for payment replay', async () => {
  reset();
  await recordPrepaidRenewalWithVerifiedSources(request);
  await recordPrepaidRenewalWithVerifiedSources(request);
  assert.equal(persistedInputs.length, 2);
  const first = persistedInputs[0][0] as { contractId: string };
  const second = persistedInputs[1][0] as { contractId: string };
  assert.equal(first.contractId, second.contractId);
  assert.match(first.contractId, /^renewal-[a-f0-9]{64}$/);
  assert.equal(persistedInputs[0][1], proposalId);
  assert.equal(persistedInputs[1][1], proposalId);
});

test('integrated renewal: payment approved before buyer acceptance cannot create successor', async () => {
  reset();
  providerApprovedAt = '2026-11-01T09:30:00.000Z';
  await assert.rejects(
    recordPrepaidRenewalWithVerifiedSources(request),
    /RENEWAL_PAYMENT_PRECEDES_ACCEPTANCE/,
  );
  assert.equal(calls.includes('provider'), true);
  assert.equal(calls.includes('persist'), false);
  assert.equal(persistedInputs.length, 0);
});

const checkoutBundle = await build({
  entryPoints: ['server/payments/prepaidRenewalCheckoutPreparation.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'isolate-renewal-checkout-preparation',
    setup(plugin) {
      plugin.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|prepaidRenewalActivation\.js$|commercialRecipientAuthorityService\.js$|prepaidRenewalRecipientBinding\.js$/ },
        args => ({ path: args.path, namespace: 'renewal-checkout-isolated' }));
      plugin.onLoad({ filter: /.*/, namespace: 'renewal-checkout-isolated' }, args => {
        if (args.path.endsWith('commercialRecipientAuthorityService.js')) return {
          contents: `export const resolveCommercialRecipientAuthority = async () => ({
            context: 'store_subscription', recipientKind: 'merchant_store',
            credentialAuthority: 'store_oauth_vault', canonicalStoreId: 'store-a',
            ownerUserId: 'owner-a', credentialScopeId: 'owner-a', externalAccountId: '12345',
          });`, loader: 'js',
        };
        if (args.path.endsWith('prepaidRenewalRecipientBinding.js')) return {
          contents: `export const resolvePrepaidRenewalRecipientBinding = input => {
            if (input.storedSellerCredentialScopeId !== 'store-a') throw new Error('RENEWAL_RECIPIENT_AUTHORITY_MISMATCH');
            return { credentialScopeId: 'owner-a', externalAccountId: '12345' };
          };`, loader: 'js',
        };
        if (args.path.endsWith('firebaseAdmin.js')) return {
          contents: `export const adminDb = { doc: path => ({ get: async () => globalThis.__renewalIntegratedMock('get', path) }) };`,
          loader: 'js',
        };
        if (args.path.endsWith('consultantAuth.js')) return {
          contents: `export const authenticateConsultantRequest = async token => {
            const user = globalThis.__renewalIntegratedMock('auth', token);
            return { ...user, email: 'buyer@example.com' };
          };`,
          loader: 'js',
        };
        return {
          contents: `export const loadAcceptedPrepaidRenewal = async input => {
            globalThis.__renewalIntegratedMock('load', input);
            return { proposal: globalThis.__renewalCheckoutProposal, acceptance: globalThis.__renewalCheckoutAcceptance };
          };`,
          loader: 'js',
        };
      });
    },
  }],
});
const { prepareAuthenticatedPrepaidRenewalPix } = await import(
  'data:text/javascript;base64,' + Buffer.from(checkoutBundle.outputFiles[0].text).toString('base64')
);
const checkoutGlobals = globalThis as typeof globalThis & {
  __renewalCheckoutProposal?: unknown;
  __renewalCheckoutAcceptance?: unknown;
  __renewalIntegratedMock?: (name: string, value: unknown) => unknown;
};
checkoutGlobals.__renewalCheckoutProposal = proposal;
const freshCheckoutAcceptance = { ...acceptance, acceptedAt: new Date(Date.now() - 60_000).toISOString() };
checkoutGlobals.__renewalCheckoutAcceptance = freshCheckoutAcceptance;
const resetCheckout = () => {
  reset();
  data = { ...data, acceptance: freshCheckoutAcceptance, acceptedAt: freshCheckoutAcceptance.acceptedAt };
};
const originalRenewalMock = checkoutGlobals.__renewalIntegratedMock!;
checkoutGlobals.__renewalIntegratedMock = (name, value) => {
  if (name === 'load') {
    calls.push('load');
    const input = value as { authenticatedBuyerId: string };
    if (input.authenticatedBuyerId !== buyerId) throw new Error('RENEWAL_ACCEPTANCE_REQUIRED');
    return null;
  }
  return originalRenewalMock(name, value);
};

test('authenticated renewal checkout preparation uses accepted Firestore amount and seller binding', async () => {
  resetCheckout();
  const result = await prepareAuthenticatedPrepaidRenewalPix({
    authorization: 'Bearer valid', storeId, proposalId,
  });
  const body = JSON.parse(result.init.body);
  assert.equal(body.external_reference, reference);
  assert.equal(body.transaction_amount, proposal.totalDueMinor / 100);
  assert.equal(body.payer.email, 'buyer@example.com');
  assert.deepEqual(calls, ['auth', 'load', 'get', 'get', 'get']);
  assert.equal(calls.includes('provider'), false);
});

test('authenticated renewal checkout preparation blocks wrong buyer and tampered binding', async () => {
  resetCheckout(); authenticatedUid = 'another-buyer';
  await assert.rejects(prepareAuthenticatedPrepaidRenewalPix({
    authorization: 'Bearer valid', storeId, proposalId,
  }), /RENEWAL_ACCEPTANCE_REQUIRED/);
  assert.deepEqual(calls, ['auth', 'load']);
  resetCheckout(); data = { ...data, sellerCredentialScopeId: 'other-store' };
  await assert.rejects(prepareAuthenticatedPrepaidRenewalPix({
    authorization: 'Bearer valid', storeId, proposalId,
  }), /RENEWAL_RECIPIENT_AUTHORITY_MISMATCH/);
  assert.deepEqual(calls, ['auth', 'load', 'get', 'get', 'get']);
});
