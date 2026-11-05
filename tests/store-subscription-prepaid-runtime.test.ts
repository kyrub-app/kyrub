import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

let docs: Map<string, any>;
let uid = 'buyer-a';
let providerCalls = 0;
const sourcePath = 'stores/store-a/subscriptions/sub-a';
const contractPath = 'stores/store-a/prepaidSubscriptionContracts/contract-a';
const paymentPath = 'prepaidRenewalPaymentBindings/' + createHash('sha256').update('mercado_pago:12345').digest('hex');
const snap = (path: string) => ({ id: path.split('/').at(-1), exists: docs.has(path),
  data: () => structuredClone(docs.get(path)), get: (field: string) => docs.get(path)?.[field] });
const document = (path: string) => ({ path, id: path.split('/').at(-1), get: async () => snap(path),
  set: async (data: any) => docs.set(path, data) });
const collection = (path: string, predicates: Array<(data: any) => boolean> = []): any => ({
  where: (field: string, _op: string, value: unknown) => collection(path, [...predicates, data => data[field] === value]),
  get: async () => {
    const found = [...docs.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
      .filter(p => predicates.every(predicate => predicate(docs.get(p)))).map(p => snap(p));
    return { docs: found, empty: found.length === 0, size: found.length };
  },
});
const mock = { db: { doc: document, collection,
  runTransaction: async (callback: any) => callback({
    get: async (ref: any) => snap(ref.path),
    create: (ref: any, data: any) => { assert(!docs.has(ref.path)); docs.set(ref.path, structuredClone(data)); },
    set: (ref: any, data: any) => docs.set(ref.path, structuredClone(data)),
  }) },
  auth: () => ({ uid, email: uid + '@example.test' }),
  provider: () => { providerCalls++; throw new Error('UNEXPECTED_PROVIDER_PREAPPROVAL'); },
};
(globalThis as any).__prepaidRuntime = mock;
const bundle = await build({ stdin: { contents: `
  export * from './server/payments/storeSubscriptionService.ts';
  export * from './server/payments/storeSubscriptionBenefitService.ts';
  export * from './server/payments/storeSubscriptionBenefitLedgerService.ts';
  export * from './server/payments/storeSubscriberRegistryService.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-prepaid-erp', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|mercadoPagoStoreOauthService\.js$|commercialRecipientAuthorityService\.js$|mercadoPagoPixProvider\.js$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents:
      a.path.endsWith('firebaseAdmin.js') ? 'export const adminDb=globalThis.__prepaidRuntime.db;' :
      a.path.endsWith('consultantAuth.js') ? 'export const authenticateConsultantRequest=async()=>globalThis.__prepaidRuntime.auth();' :
      a.path.endsWith('mercadoPagoStoreOauthService.js') ? 'export const mercadoPagoStoreRequest=async()=>globalThis.__prepaidRuntime.provider();' :
      a.path.endsWith('commercialRecipientAuthorityService.js') ? 'export const resolveCommercialRecipientAuthority=async()=>{throw Error("UNEXPECTED_RECIPIENT_LOOKUP")};' :
      'export const verifyMercadoPagoWebhookSignature=async()=>{throw Error("UNEXPECTED_WEBHOOK")};',
    }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
beforeEach(() => {
  uid = 'buyer-a'; providerCalls = 0;
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 90 * 86400_000).toISOString();
  docs = new Map([
    ['stores/store-a', { id: 'store-a', ownerId: 'owner-a', legacyTenantId: 'owner-a', publicationStatus:'published' }],
    ['tenants/owner-a', {id:'owner-a', ownerId:'owner-a', publicationStatus:'published'}],
    [sourcePath, { schemaVersion: 1, id: 'sub-a', storeId: 'store-a', ownerUserId: 'owner-a', legacyStoreId: 'owner-a',
      buyerId: 'buyer-a', buyerEmail: 'buyer-a@example.test', productId: 'product-a', productName: 'Membership',
      amountMinor: 30000, currency: 'BRL', collectionMode: 'prepaid', contractedMonths: 3,
      saleModality: { schemaVersion: 1, mode: 'subscription', subscription: { schemaVersion: 1, autoRenew: false,
        billingInterval: { unit: 'month', count: 1 }, benefit: { kind: 'usage_credits', unitsPerCycle: 10 } } },
      credentialScopeId: 'owner-a', externalAccountId: '42', provider: 'mercado_pago', providerSubscriptionId: '',
      providerStatus: 'authorized', state: 'active', providerInvoiceId: '', providerPaymentId: '12345',
      providerPaymentStatus: 'approved', providerPaymentStatusDetail: 'accredited', startsAt: start, expiresAt: end,
      paymentConfirmedAt: start, activatedAt: start, createdAt: start, updatedAt: start,
    }],
    [sourcePath + '/prepaidPeriods/contract-a', { contractId: 'contract-a', storeId: 'store-a', subscriptionId: 'sub-a',
      buyerId: 'buyer-a', productId: 'product-a', startsAt: start, expiresAt: end, providerPaymentId: '12345', paidAmountMinor: 30000, state: 'paid' }],
    [contractPath, { contractId: 'contract-a', storeId: 'store-a', subscriptionId: 'sub-a', customerId: 'buyer-a', productId: 'product-a',
      startsAt: start, expiresAt: end, providerPaymentId: '12345', totalPaidMinor: 30000 }],
    [paymentPath, { provider: 'mercado_pago', providerPaymentId: '12345', storeId: 'store-a', subscriptionId: 'sub-a', contractId: 'contract-a', contractPath }],
  ]);
});
const input = { storeId: 'store-a', subscriptionId: 'sub-a' };
test('canonical prepaid subscription is read/reconciled without any recurring provider endpoint', async () => {
  const current = await api.getAuthorizedStoreSubscription('test', input);
  assert.equal(current.state, 'active'); assert.equal(current.collectionMode, 'prepaid');
  assert.equal(current.providerSubscriptionId, ''); assert.equal(current.saleModality.subscription.autoRenew, false);
  assert.equal((await api.reconcileAuthorizedStoreSubscription('test', input)).state, 'active');
  assert.equal(providerCalls, 0);
});
test('cancel action preserves prepaid access and never attempts financial cancellation', async () => {
  assert.equal((await api.cancelAuthorizedStoreSubscription('test', input)).state, 'active');
  assert.equal(providerCalls, 0);
});
test('expired prepaid coverage is not an active subscription', async () => {
  for (const path of [contractPath, sourcePath + '/prepaidPeriods/contract-a']) {
    docs.get(path).startsAt = '2020-01-01T00:00:00Z'; docs.get(path).expiresAt = '2020-04-01T00:00:00Z';
  }
  assert.equal((await api.getAuthorizedStoreSubscription('test', input)).state, 'payment_due');
});
test('invalid payment binding and cross-buyer reads fail closed', async () => {
  docs.get(paymentPath).subscriptionId = 'other';
  await assert.rejects(api.getAuthorizedStoreSubscription('test', input), (error: any) => error.code === 'STORE_SUBSCRIPTION_PREPAID_PAYMENT_BINDING_INVALID');
  uid = 'other'; await assert.rejects(api.getAuthorizedStoreSubscription('test', input), /outro usuário/);
});
test('prepaid credits reuse canonical cycles and consuming twice with one operation does not duplicate', async () => {
  uid = 'owner-a';
  const cycle = await api.reconcileStoreSubscriptionBenefitCycle('store-a', 'sub-a');
  assert.equal(cycle.grantedUnits, 10);
  const first = await api.consumeAuthorizedStoreSubscriptionBenefit('test', { ...input, units: 3, operationId: 'use-1' });
  const replay = await api.consumeAuthorizedStoreSubscriptionBenefit('test', { ...input, units: 3, operationId: 'use-1' });
  assert.equal(first.cycle.remainingUnits, 7); assert.equal(replay.cycle.remainingUnits, 7); assert.equal(replay.duplicate, true);
  assert.equal((await api.reconcileStoreSubscriptionBenefitCycle('store-a', 'sub-a')).remainingUnits, 7);
});
test('an unverified prepaid period never creates benefit credits', async () => {
  docs.delete(paymentPath);
  await assert.rejects(api.reconcileStoreSubscriptionBenefitCycle('store-a', 'sub-a'), (error: any) => error.code === 'STORE_SUBSCRIPTION_PREPAID_PAYMENT_BINDING_INVALID');
  assert.equal([...docs.keys()].filter(path => path.includes('/benefitCycles/')).length, 0);
});
test('ERP registry recognizes the same canonical prepaid subscription with total and coverage', async () => {
  uid = 'owner-a';
  const registry = await api.loadAuthorizedStoreSubscriberRegistry('test', 'store-a');
  assert.equal(registry.subscriberCount, 1);
  const summary = registry.subscribers[0].subscriptions[0];
  assert.equal(summary.id, 'sub-a'); assert.equal(summary.collectionMode, 'prepaid');
  assert.equal(summary.amountMinor, 30000); assert.equal(summary.contractedMonths, 3);
});
test('advance-paid renewal extends ERP expiry without granting future credits early', async () => {
  uid = 'owner-a';
  await api.consumeAuthorizedStoreSubscriptionBenefit('test', { ...input, units: 3, operationId: 'prior-use' });
  const current = docs.get(contractPath);
  const startsAt = current.expiresAt;
  const expiresAt = new Date(Date.parse(startsAt) + 90 * 86400_000).toISOString();
  const nextPath = 'stores/store-a/prepaidSubscriptionContracts/contract-next';
  docs.set(nextPath, { ...current, contractId: 'contract-next', startsAt, expiresAt, providerPaymentId: '23456' });
  docs.set(sourcePath + '/prepaidPeriods/contract-next', { ...docs.get(sourcePath + '/prepaidPeriods/contract-a'),
    contractId: 'contract-next', startsAt, expiresAt, providerPaymentId: '23456' });
  docs.set('prepaidRenewalPaymentBindings/' + createHash('sha256').update('mercado_pago:23456').digest('hex'), {
    provider: 'mercado_pago', providerPaymentId: '23456', storeId: 'store-a', contractId: 'contract-next', contractPath: nextPath,
  });
  assert.equal((await api.reconcileStoreSubscriptionBenefitCycle('store-a', 'sub-a')).remainingUnits, 7);
  uid = 'buyer-a';
  assert.equal((await api.getAuthorizedStoreSubscription('test', input)).expiresAt, expiresAt);
});
test('overlapping verified contracts fail closed before issuing additional benefits', async () => {
  const current = docs.get(contractPath);
  const nextPath = 'stores/store-a/prepaidSubscriptionContracts/contract-overlap';
  docs.set(nextPath, { ...current, contractId: 'contract-overlap', providerPaymentId: '34567' });
  docs.set(sourcePath + '/prepaidPeriods/contract-overlap', { ...docs.get(sourcePath + '/prepaidPeriods/contract-a'),
    contractId: 'contract-overlap', providerPaymentId: '34567' });
  docs.set('prepaidRenewalPaymentBindings/' + createHash('sha256').update('mercado_pago:34567').digest('hex'), {
    provider: 'mercado_pago', providerPaymentId: '34567', storeId: 'store-a', contractId: 'contract-overlap', contractPath: nextPath,
  });
  await assert.rejects(api.reconcileStoreSubscriptionBenefitCycle('store-a', 'sub-a'),
    (error: any) => error.code === 'STORE_SUBSCRIPTION_PREPAID_PERIOD_OVERLAP');
  assert.equal([...docs.keys()].filter(path => path.includes('/benefitCycles/')).length, 0);
});
test('administrative suspension is not overridden by prepaid proof', async () => {
  docs.get(sourcePath).state = 'paused';
  assert.equal((await api.getAuthorizedStoreSubscription('test', input)).state, 'paused');
  assert.equal(await api.reconcileStoreSubscriptionBenefitCycle('store-a', 'sub-a'), null);
});
