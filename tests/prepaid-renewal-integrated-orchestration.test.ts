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
const calls: string[] = [];

const bundled = await build({
  entryPoints: ['server/payments/prepaidRenewalActivation.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'isolate-renewal-boundaries',
    setup(plugin) {
      plugin.onResolve({ filter: /firebaseAdmin\.js$|prepaidRenewalPaymentVerification\.js$|consultantAuth\.js$|persistedPrepaidRenewal\.js$/ }, args =>
        ({ path: args.path, namespace: 'renewal-isolated' }));
      plugin.onLoad({ filter: /.*/, namespace: 'renewal-isolated' }, args => {
        let contents = '';
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
      if (path.endsWith('/prepaidRenewalProposals/' + proposalId))
        return { exists: true, data: () => data };
      if (path.endsWith('/prepaidSubscriptionContracts/old-contract'))
        return { exists: true, get: (field: string) => ({
          storeId, contractId: 'old-contract', customerId: buyerId,
          productId: 'subscription', months: 3, expiresAt: '2027-01-01T00:00:00.000Z',
        } as Record<string, unknown>)[field] };
      throw new Error('UNEXPECTED_DOC:' + path);
    }
    if (name === 'provider') {
      if (paymentFailure) throw new Error('RENEWAL_PROVIDER_PAYMENT_MISMATCH');
      const input = value as Record<string, unknown>;
      assert.equal(input.sellerCredentialScopeId, storeId);
      assert.equal(input.expectedExternalReference, reference);
      assert.equal(input.expectedAmountMinor, proposal.totalDueMinor);
      return {
        id: '12345', status: 'approved', amountMinor: proposal.totalDueMinor,
        occurredAt: '2026-11-01T11:00:00.000Z', verifiedByProvider: true,
      };
    }
    if (name === 'persist') return 'created';
    throw new Error('UNEXPECTED_CALL:' + name);
  };
const request = { authorization: 'Bearer valid', storeId, proposalId, paymentId: '12345' };
const reset = () => {
  calls.length = 0; data = makeData(); authenticatedUid = buyerId; paymentFailure = false;
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
  await assert.rejects(recordPrepaidRenewalWithVerifiedSources(request), /RENEWAL_CHECKOUT_BINDING_MISSING/);
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
  assert.deepEqual(calls, ['auth', 'get', 'get', 'provider', 'get', 'get', 'get', 'persist']);
});
