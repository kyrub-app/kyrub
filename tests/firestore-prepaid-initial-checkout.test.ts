import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { build } from 'esbuild';
import { adminDb } from '../server/firebaseAdmin.js';

if (!process.env.FIRESTORE_EMULATOR_HOST || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  throw new Error('INITIAL_PREPAID_LOCAL_EMULATOR_REQUIRED');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
const state = { db: adminDb, payments: new Map<string, any>(), posts: 0, unknown: false, mismatch: '',
  calls: [] as string[], failure: false, nextPaymentId: 910000000, afterCreate: null as null | (() => Promise<void>) };
(globalThis as any).__initialPrepaidEmulator = state;
const compiled = await build({ stdin: { resolveDir: process.cwd(), contents: `
 export * from './server/payments/initialPrepaidSubscriptionCheckout.ts';
 export * from './server/payments/storeSubscriptionBenefitService.ts';
 export * from './server/payments/storeSubscriptionService.ts';
 export * from './server/payments/prepaidRenewalProposalCreation.ts';
 export * from './server/payments/prepaidRenewalAcceptance.ts';
 export * from './server/payments/prepaidRenewalPixCheckout.ts';` },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'real-emulator-simulated-payment-provider', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|commercialRecipientAuthorityService\.js$|mercadoPagoStoreOauthService\.js$|mercadoPagoPixProvider\.js$/ }, a => ({ path: a.path, namespace: 'isolated' }));
    b.onLoad({ filter: /.*/, namespace: 'isolated' }, a => ({ contents:
      a.path.endsWith('firebaseAdmin.js') ? `export const adminDb=globalThis.__initialPrepaidEmulator.db;` :
      a.path.endsWith('mercadoPagoPixProvider.js') ? `export const verifyMercadoPagoWebhookSignature=async input=>{if(input.headers["x-test-signature"]!=="signed")throw Error("INVALID_SIGNATURE");};` :
      a.path.endsWith('consultantAuth.js') ? `export const authenticateConsultantRequest=async token=>{if(!token)throw Error('AUTH_REQUIRED');return {uid:token,email:token+'@example.test',emailVerified:true};};` :
      a.path.endsWith('commercialRecipientAuthorityService.js') ? `export const resolveCommercialRecipientAuthority=async input=>({context:'store_subscription',recipientKind:'merchant_store',credentialAuthority:'store_oauth_vault',canonicalStoreId:input.canonicalStoreId,ownerUserId:'initial-owner',credentialScopeId:'initial-owner',externalAccountId:'987654'});` : `
      export const getValidMercadoPagoStoreAccessToken=async scope=>{if(scope!=='initial-owner')throw Error('WRONG_SELLER');return {externalAccountId:'987654'};};
      export const mercadoPagoStoreRequest=async(scope,path,init={})=>{
        const s=globalThis.__initialPrepaidEmulator;if(scope!=='initial-owner')throw Error('WRONG_SELLER');s.calls.push((init.method||'GET')+' '+path);
        if(path.includes('preapproval'))throw Error('RECURRING_ENDPOINT_FORBIDDEN_IN_PREPAID_TEST');
        if(init.method==='POST'){
          s.posts++;const body=JSON.parse(init.body);if(body.auto_recurring||body.installments)throw Error('RECURRING_PAYLOAD_FORBIDDEN');
          const id=String(++s.nextPaymentId);const p={...body,id,status:'pending',currency_id:'BRL',collector_id:987654,
            point_of_interaction:{transaction_data:{qr_code:'TEST-PIX-'+id}}};s.payments.set(id,p);
          if(s.afterCreate)await s.afterCreate();if(s.unknown)throw Error('SIMULATED_LOST_RESPONSE');return p;
        }
        if(path.startsWith('/v1/payments/search?')){const q=new URLSearchParams(path.split('?')[1]);const results=[...s.payments.values()].filter(p=>p.external_reference===q.get('external_reference'));return {paging:{total:results.length,offset:0,limit:Number(q.get('limit'))},results};}
        const p=s.payments.get(path.split('/').pop());if(!p)throw Error('PAYMENT_NOT_FOUND');return p;
      };` }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function seed(suffix: string, months: 3 | 6 | 12 = 3, benefitKind: 'access' | 'usage_credits' = 'usage_credits', catalogAutoRenew = false) {
  const storeId = 'initial-emulator-' + suffix;
  await adminDb.doc(`stores/${storeId}`).set({ ownerId: 'initial-owner', legacyTenantId: 'initial-owner', name: 'Isolated Test' });
  await adminDb.doc('tenants/initial-owner').set({ publicationStatus: 'published' });
  await adminDb.doc('stores/initial-owner/paymentProviderConnections/mercado_pago').set({
    provider: 'mercado_pago', storeId: 'initial-owner', status: 'connected', externalAccountId: '987654',
  });
  await adminDb.doc(`stores/${storeId}/products/product`).set({ name: 'Monthly access', price: 100,
    publicationStatus: 'published', contractDiscounts: [{ months: 1, discountPercent: 0 },
      { months: 3, discountPercent: 10 }, { months: 6, discountPercent: 15 }, { months: 12, discountPercent: 20 }],
    saleModality: { schemaVersion: 1, mode: 'subscription', subscription: { schemaVersion: 1, autoRenew: catalogAutoRenew,
      billingInterval: { unit: 'month', count: 1 }, benefit: { kind: benefitKind, unitsPerCycle: benefitKind === 'access' ? null : 10 } } },
  });
  process.env.KYRUB_INITIAL_PREPAID_PIX_CHECKOUT_ENABLED = 'true';
  const quoted = await api.quoteInitialPrepaidSubscription({ authorization: 'initial-buyer', storeId, productId: 'product', months });
  const input = { authorization: 'initial-buyer', storeId, checkoutId: quoted.checkoutId };
  await api.acceptInitialPrepaidSubscription({ ...input, acceptedTotalMinor: quoted.quote.totalMinor });
  return { ...input, quote: quoted.quote };
}
function approved(id: string) {
  Object.assign(state.payments.get(id), { status: 'approved', status_detail: 'accredited', date_approved: new Date().toISOString() });
}
for (const months of [3, 6, 12] as const) test(`initial ${months}-month Pix materializes exactly one canonical contract and usable benefits`, async () => {
  state.unknown = false;
  const input = await seed('term-' + months, months); const before = state.posts;
  const pending = await api.checkoutInitialPrepaidSubscription(input);
  assert.equal(pending.state, 'awaiting_payment'); assert.equal(state.posts, before + 1);
  const id = pending.paymentId; approved(id);
  const active = await api.reconcileInitialPrepaidSubscription(input);
  assert.equal(active.state, 'activated');
  const subRef = adminDb.doc(`stores/${input.storeId}/subscriptions/${active.subscriptionId}`);
  const sub = (await subRef.get()).data();
  assert.equal(sub!.collectionMode, 'prepaid'); assert.equal(sub!.saleModality.subscription.autoRenew, false);
  assert.equal(sub!.providerSubscriptionId, ''); assert.equal(sub!.providerInvoiceId, '');
  const contract = await adminDb.doc(`stores/${input.storeId}/prepaidSubscriptionContracts/${active.contractId}`).get();
  assert.equal(contract.get('subscriptionId'), active.subscriptionId); assert.equal(contract.get('months'), months);
  assert.equal(contract.get('totalPaidMinor'), input.quote.totalMinor);
  const start = new Date(active.startsAt), end = new Date(active.expiresAt);
  assert.equal(end.getUTCFullYear() * 12 + end.getUTCMonth() - (start.getUTCFullYear() * 12 + start.getUTCMonth()), months);
  const current = await api.getAuthorizedStoreSubscription(input.authorization, { storeId: input.storeId, subscriptionId: active.subscriptionId });
  assert.equal(current.state, 'active');
  const cycle = await api.reconcileStoreSubscriptionBenefitCycle(input.storeId, active.subscriptionId);
  assert.equal(cycle.grantedUnits, 10); assert.equal(cycle.remainingUnits, 10);
  const used = await api.consumeAuthorizedStoreSubscriptionBenefit('initial-owner', {
    storeId: input.storeId, subscriptionId: active.subscriptionId, units: 2, operationId: 'consume-once',
  });
  assert.equal(used.cycle.remainingUnits, 8);
  assert.equal((await api.consumeAuthorizedStoreSubscriptionBenefit('initial-owner', {
    storeId: input.storeId, subscriptionId: active.subscriptionId, units: 2, operationId: 'consume-once',
  })).duplicate, true);
  const replay = await api.reconcileInitialPrepaidSubscription(input);
  assert.equal(replay.subscriptionId, active.subscriptionId); assert.equal(replay.contractId, active.contractId);
  assert.equal((await api.reconcileStoreSubscriptionBenefitCycle(input.storeId, active.subscriptionId)).remainingUnits, 8);
  assert.equal((await adminDb.collection(`stores/${input.storeId}/prepaidSubscriptionContracts`).get()).size, 1);
  assert.equal((await subRef.collection('prepaidPeriods').get()).size, 1);
  assert.equal(state.posts, before + 1);
  await assert.rejects(api.getAuthorizedStoreSubscription('intruder', { storeId: input.storeId, subscriptionId: active.subscriptionId }));
});
test('pending, rejected and mismatched provider payments cannot activate a contract', async () => {
  const input = await seed('mismatches'); const pending = await api.checkoutInitialPrepaidSubscription(input);
  assert.equal((await api.reconcileInitialPrepaidSubscription(input)).state, 'awaiting_payment');
  const p = state.payments.get(pending.paymentId); p.status = 'rejected';
  assert.equal((await api.reconcileInitialPrepaidSubscription(input)).state, 'rejected');
  approved(pending.paymentId);
  for (const [field, bad] of [['currency_id', 'USD'], ['transaction_amount', 1], ['collector_id', 123], ['external_reference', 'other']] as const) {
    const old = p[field]; p[field] = bad;
    await assert.rejects(api.reconcileInitialPrepaidSubscription(input)); p[field] = old;
    assert.equal((await adminDb.collection(`stores/${input.storeId}/subscriptions`).get()).size, 0);
  }
});
test('simultaneous checkout attempts create one Pix; unknown response recovers through GET only', async () => {
  const input = await seed('concurrent'); state.unknown = true; const before = state.posts;
  await Promise.allSettled([api.checkoutInitialPrepaidSubscription(input), api.checkoutInitialPrepaidSubscription(input)]);
  state.unknown = false; assert.equal(state.posts, before + 1);
  const recovered = await api.reconcileInitialPrepaidSubscription(input); assert.equal(recovered.state, 'awaiting_payment');
  approved(recovered.paymentId);
  const results = await Promise.all([api.reconcileInitialPrepaidSubscription(input), api.reconcileInitialPrepaidSubscription(input)]);
  assert.equal(results[0].contractId, results[1].contractId); assert.equal(state.posts, before + 1);
});
test('activation failure rolls back materialization and reprocesses the same paid Pix safely', async () => {
  const input = await seed('recover-activation'); const p = await api.checkoutInitialPrepaidSubscription(input); approved(p.paymentId);
  const slotRef = adminDb.doc(`stores/${input.storeId}/subscriptionCheckoutSlots/${hash('initial-buyer:product')}`);
  await slotRef.update({ checkoutId: 'another-checkout' });
  await assert.rejects(api.reconcileInitialPrepaidSubscription(input));
  assert.equal((await adminDb.collection(`stores/${input.storeId}/subscriptions`).get()).size, 0);
  await slotRef.update({ checkoutId: input.checkoutId });
  assert.equal((await api.reconcileInitialPrepaidSubscription(input)).state, 'activated');
});
test('first paid contract is an explicit source for the existing early renewal flow', async () => {
  const input = await seed('renewal-chain'); const p = await api.checkoutInitialPrepaidSubscription(input); approved(p.paymentId);
  const first = await api.reconcileInitialPrepaidSubscription(input);
  const proposed = await api.createOwnerAuthorizedPrepaidRenewalProposal({ authorization: 'initial-owner', storeId: input.storeId, previousContractId: first.contractId });
  await api.acceptPrepaidRenewalWithFirebaseAuth({ authorization: 'initial-buyer', storeId: input.storeId,
    proposalId: proposed.proposalId, acceptedTotalMinor: input.quote.totalMinor });
  process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED = 'true';
  const locator = { authorization: 'initial-buyer', storeId: input.storeId, proposalId: proposed.proposalId };
  const renewal = await api.checkoutAuthenticatedPrepaidRenewalPix(locator); approved(renewal.paymentId);
  const next = await api.reconcileAuthenticatedPrepaidRenewalPix(locator);
  assert.equal(next.state, 'activated'); assert.equal(next.contract.startsAt, first.expiresAt);
  const contract = await adminDb.doc(`stores/${input.storeId}/prepaidSubscriptionContracts/${next.contract.contractId}`).get();
  assert.equal(contract.get('subscriptionId'), first.subscriptionId);
  assert.equal((await adminDb.collection(`stores/${input.storeId}/subscriptions`).get()).size, 1);
  assert.equal((await api.reconcileStoreSubscriptionBenefitCycle(input.storeId, first.subscriptionId)).remainingUnits, 10);
});

for (const lostResponse of [true, false]) test(`signed webhook replay preserves activated state with creator response lost=${lostResponse}`, async () => {
  const input = await seed('webhook-race-' + lostResponse);
  let created!: () => void, release!: () => void;
  const reachedProvider = new Promise<void>(resolve => { created = resolve; });
  const resumeCreator = new Promise<void>(resolve => { release = resolve; });
  state.afterCreate = async () => { created(); await resumeCreator; if (lostResponse) throw Error('SIMULATED_LOST_RESPONSE'); };
  const creation = api.checkoutInitialPrepaidSubscription(input);
  await reachedProvider;
  try {
    const pending = await api.reconcileInitialPrepaidSubscription(input);
    approved(pending.paymentId);
    const notification = { storeId: input.storeId, checkoutId: input.checkoutId, dataId: pending.paymentId,
      headers: { 'x-test-signature': 'signed' } };
    await assert.rejects(api.handleInitialPrepaidSubscriptionWebhook({ ...notification, headers: {} }));
    const activated = await api.handleInitialPrepaidSubscriptionWebhook(notification);
    assert.equal(activated.state, 'activated');
    assert.equal((await api.handleInitialPrepaidSubscriptionWebhook(notification)).contractId, activated.contractId);
    release(); await creation;
    assert.equal((await adminDb.doc(`stores/${input.storeId}/prepaidSubscriptionCheckouts/${input.checkoutId}`).get()).get('status'), 'activated');
    assert.equal((await adminDb.collection(`stores/${input.storeId}/subscriptions`).get()).size, 1);
    assert.equal((await adminDb.collection(`stores/${input.storeId}/prepaidSubscriptionContracts`).get()).size, 1);
  } finally { release(); state.afterCreate = null; await creation; }
});
test('foreign buyer/store and a payment globally consumed by another store cannot activate', async () => {
  const input = await seed('isolation');
  await assert.rejects(api.checkoutInitialPrepaidSubscription({ ...input, authorization: 'other-buyer' }));
  await assert.rejects(api.reconcileInitialPrepaidSubscription({ ...input, storeId: 'foreign-store' }));
  const pending = await api.checkoutInitialPrepaidSubscription(input); approved(pending.paymentId);
  const binding = adminDb.doc(`prepaidRenewalPaymentBindings/${hash('mercado_pago:' + pending.paymentId)}`);
  await binding.set({ provider: 'mercado_pago', providerPaymentId: pending.paymentId, storeId: 'foreign-store', contractPath: 'foreign/contract' });
  await assert.rejects(api.reconcileInitialPrepaidSubscription(input), /PAYMENT_ALREADY_USED/);
  assert.equal((await adminDb.collection(`stores/${input.storeId}/subscriptions`).get()).size, 0);
  assert.equal((await adminDb.collection(`stores/${input.storeId}/prepaidSubscriptionContracts`).get()).size, 0);
  assert.equal((await binding.get()).get('storeId'), 'foreign-store');
});

test('client security rules deny direct writes to prepaid financial and entitlement records', async () => {
  await adminDb.doc('stores/initial-emulator-rules').set({ ownerId: 'initial-owner', legacyTenantId: 'initial-owner' });
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  const env = await initializeTestEnvironment({ projectId: 'kyrub-security-test',
    firestore: { host, port: Number(port), rules: await readFile('.firebase/firestore.combined.rules', 'utf8') } });
  try {
    for (const uid of ['initial-buyer', 'initial-owner', 'other-buyer']) {
      const client = env.authenticatedContext(uid).firestore();
      for (const path of [
        'stores/initial-emulator-rules/prepaidSubscriptionCheckouts/intent',
        'stores/initial-emulator-rules/subscriptionCheckoutSlots/slot',
        'stores/initial-emulator-rules/subscriptions/subscription',
        'stores/initial-emulator-rules/subscriptions/subscription/prepaidPeriods/period',
        'stores/initial-emulator-rules/prepaidSubscriptionContracts/contract',
        'prepaidRenewalPaymentBindings/payment',
      ]) {
        await assertFails(setDoc(doc(client, path), { buyerId: uid, state: 'active', status: 'approved' }));
        await assertFails(deleteDoc(doc(client, path)));
      }
      await assertFails(getDoc(doc(client, 'stores/initial-emulator-term-3/prepaidSubscriptionCheckouts/private')));
    }
  } finally { await env.cleanup(); }
});

test('verified initial access benefit is consumed by the existing subscription benefit reader', async () => {
  const input = await seed('access-benefit', 6, 'access');
  const pending = await api.checkoutInitialPrepaidSubscription(input); approved(pending.paymentId);
  const active = await api.reconcileInitialPrepaidSubscription(input);
  const cycle = await api.reconcileStoreSubscriptionBenefitCycle(input.storeId, active.subscriptionId);
  assert.equal(cycle.benefitKind, 'access'); assert.equal(cycle.state, 'available');
  assert.equal(cycle.grantedUnits, null);
  assert.equal((await api.getAuthorizedStoreSubscription('initial-buyer', { storeId: input.storeId, subscriptionId: active.subscriptionId })).state, 'active');
});

test('legacy recurring checkout cannot overwrite an unresolved initial Pix slot', async () => {
  const input = await seed('cross-collection-lock', 3, 'access', true);
  const pending = await api.checkoutInitialPrepaidSubscription(input);
  const posts = state.posts;
  // Even if the merchant later changes the catalog to a recurring-only offer,
  // the accepted Pix cannot be displaced by the legacy checkout.
  const productRef = adminDb.doc(`stores/${input.storeId}/products/product`);
  const recurringProduct = (await productRef.get()).data()!;
  delete recurringProduct.contractDiscounts;
  await productRef.set(recurringProduct);
  const slot = adminDb.doc(`stores/${input.storeId}/subscriptionCheckoutSlots/${hash('initial-buyer:product')}`);
  await assert.rejects(api.createAuthorizedStoreSubscription('initial-buyer', {
    storeId: input.storeId, productId: 'product',
  }), /pré-paga em reconciliação/);
  assert.equal(state.posts, posts);
  assert.equal((await slot.get()).get('checkoutId'), input.checkoutId);
  approved(pending.paymentId);
  assert.equal((await api.reconcileInitialPrepaidSubscription(input)).state, 'activated');
});
