import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';
import { adminDb } from '../server/firebaseAdmin.js';

if (!process.env.FIRESTORE_EMULATOR_HOST ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
const fixture = { db: adminDb, posts: 0, payments: new Map<string, any>(), unknown: false };
(globalThis as any).__renewalCheckoutFlow = fixture;
const compiled = await build({ stdin: { contents: `export * from './server/payments/prepaidRenewalPixCheckout.ts';
  export { acceptPrepaidRenewalWithFirebaseAuth } from './server/payments/prepaidRenewalAcceptance.ts';`,
  resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'local-emulator-and-simulated-provider', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|commercialRecipientAuthorityService\.js$|mercadoPagoStoreOauthService\.js$/ }, a => ({ path: a.path, namespace: 'isolated' }));
    b.onLoad({ filter: /.*/, namespace: 'isolated' }, a => ({ contents:
      a.path.endsWith('firebaseAdmin.js') ? `export const adminDb=globalThis.__renewalCheckoutFlow.db;` :
      a.path.endsWith('consultantAuth.js') ? `export const authenticateConsultantRequest=async token=>{if(!token)throw Error('AUTH_REQUIRED');return {uid:token,email:token+'@example.test'};};` :
      a.path.endsWith('commercialRecipientAuthorityService.js') ? `export const resolveCommercialRecipientAuthority=async input=>({context:'store_subscription',recipientKind:'merchant_store',credentialAuthority:'store_oauth_vault',canonicalStoreId:input.canonicalStoreId,ownerUserId:'flow-owner',credentialScopeId:'flow-owner',externalAccountId:'987654'});` : `
      export const getValidMercadoPagoStoreAccessToken=async scope=>{if(scope!=='flow-owner')throw Error('WRONG_SELLER');return {externalAccountId:'987654'};};
      export const mercadoPagoStoreRequest=async(scope,path,init={})=>{
        if(scope!=='flow-owner')throw Error('WRONG_SELLER');const f=globalThis.__renewalCheckoutFlow;
        if(init.method==='POST'){
          f.posts++;const body=JSON.parse(init.body);const id=String(800000+f.posts);
          const payment={...body,id,status:'pending',currency_id:'BRL',collector_id:987654,
            point_of_interaction:{transaction_data:{qr_code:'isolated-test-pix-'+id}}};
          f.payments.set(id,payment);if(f.unknown)throw Error('SIMULATED_LOST_RESPONSE');return payment;
        }
        if(path.startsWith('/v1/payments/search?')){const q=new URLSearchParams(path.split('?')[1]);const results=[...f.payments.values()].filter(p=>p.external_reference===q.get('external_reference'));return {paging:{total:results.length,offset:0,limit:50},results};}
        const p=f.payments.get(path.split('/').pop());if(!p)throw Error('PAYMENT_NOT_FOUND');return p;
      };` }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
async function seed(suffix: string) {
  const storeId = 'checkout-flow-' + suffix;
  const proposalId = createHash('sha256').update(storeId).digest('hex');
  const previousContractId = 'previous-' + suffix;
  const proposal = { previousContractId, storeId, customerId: 'flow-buyer', productId: 'product', months: 3,
    currentMonthlyPriceMinor: 10000, discountPercent: 0, totalDueMinor: 30000, status: 'awaiting_acceptance' };
  await adminDb.doc(`stores/${storeId}`).set({ ownerId: 'flow-owner', legacyTenantId: 'flow-owner' });
  await adminDb.doc('stores/flow-owner/paymentProviderConnections/mercado_pago').set({
    provider: 'mercado_pago', storeId: 'flow-owner', status: 'connected', externalAccountId: '987654',
  });
  const subscriptionId = 'subscription-' + suffix;
  await adminDb.doc(`stores/${storeId}/subscriptions/${subscriptionId}`).set({
    id: subscriptionId, storeId, buyerId: 'flow-buyer', productId: 'product',
  });
  await adminDb.doc(`stores/${storeId}/prepaidSubscriptionContracts/${previousContractId}`).set({
    contractId: previousContractId, storeId, customerId: 'flow-buyer', productId: 'product', months: 3,
    subscriptionId, totalPaidMinor: 30000, expiresAt: '2030-01-01T00:00:00.000Z',
  });
  await adminDb.doc(`stores/${storeId}/prepaidRenewalProposals/${proposalId}`).set({
    status: 'awaiting_acceptance', proposal, createdAt: new Date(Date.now() - 1000).toISOString(),
    sellerCredentialScopeId: storeId, paymentExternalReference: `kyrub:prepaid-renewal:${storeId}:${proposalId}`,
  });
  const locator = { authorization: 'flow-buyer', storeId, proposalId };
  await api.acceptPrepaidRenewalWithFirebaseAuth({ ...locator, acceptedTotalMinor: 30000 });
  return locator;
}
test('emulator: authenticated acceptance, Pix, canonical seller and atomic coverage activation', async () => {
  process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED = 'true';
  fixture.unknown = false;
  const input = await seed('success');
  const n = fixture.posts;
  const pending = await api.checkoutAuthenticatedPrepaidRenewalPix(input);
  assert.equal(pending.state, 'awaiting_payment'); assert.match(pending.pix.qrCode, /isolated-test-pix/);
  assert.equal(fixture.posts, n + 1);
  const again = await api.checkoutAuthenticatedPrepaidRenewalPix(input);
  assert.equal(again.paymentId, pending.paymentId); assert.equal(fixture.posts, n + 1);
  const payment = fixture.payments.get(pending.paymentId);
  Object.assign(payment, { status: 'approved', status_detail: 'accredited', date_approved: new Date().toISOString() });
  const active = await api.reconcileAuthenticatedPrepaidRenewalPix(input);
  assert.equal(active.state, 'activated'); assert.equal(active.contract.startsAt, '2030-01-01T00:00:00.000Z');
  assert.equal(active.contract.expiresAt, '2030-04-01T00:00:00.000Z');
  assert.equal((await api.reconcileAuthenticatedPrepaidRenewalPix(input)).contract.contractId, active.contract.contractId);
  assert.equal(fixture.posts, n + 1);
  await assert.rejects(api.reconcileAuthenticatedPrepaidRenewalPix({ ...input, authorization: 'other-buyer' }), /ACCEPTANCE_REQUIRED/);
});
test('emulator: lost creation response recovers by seller GET without a second payment', async () => {
  const input = await seed('lost-response'); fixture.unknown = true;
  const n = fixture.posts;
  assert.equal((await api.checkoutAuthenticatedPrepaidRenewalPix(input)).state, 'recovery_required');
  fixture.unknown = false;
  const found = await api.reconcileAuthenticatedPrepaidRenewalPix(input);
  assert.equal(found.state, 'awaiting_payment'); assert.equal(fixture.posts, n + 1);
  const attempt = await adminDb.doc(`stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`).get();
  assert.equal(attempt.get('providerPaymentId'), found.paymentId);
  assert.equal((await api.checkoutAuthenticatedPrepaidRenewalPix(input)).paymentId, found.paymentId);
  assert.equal(fixture.posts, n + 1);
});
test('emulator: checkout gate disabled creates neither payment nor reservation', async () => {
  const input = await seed('disabled'); delete process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED;
  const n = fixture.posts;
  await assert.rejects(api.checkoutAuthenticatedPrepaidRenewalPix(input), /CHECKOUT_DISABLED/);
  assert.equal(fixture.posts, n);
  assert.equal((await adminDb.doc(`stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`).get()).exists, false);
});


test('emulator: missing entitlement blocks a new Pix but preserves recovery of existing attempt', async () => {
  process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED = 'true';
  fixture.unknown = false;
  const input = await seed('missing-entitlement');
  const previousRef = adminDb.doc(`stores/${input.storeId}/prepaidSubscriptionContracts/previous-missing-entitlement`);
  await previousRef.update({ subscriptionId: null });
  const n = fixture.posts;
  await assert.rejects(api.checkoutAuthenticatedPrepaidRenewalPix(input), /RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED/);
  assert.equal(fixture.posts, n);
  assert.equal((await adminDb.doc(`stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`).get()).exists, false);
});
