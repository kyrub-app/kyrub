import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const ROOT = 'kyrub_admin/control_plane';
let docs: Map<string, any>, posts = 0, payments: Map<string, any>, lost = false, failCrm = false;
let collector = '42', beforeResponse: (() => Promise<void>) | null = null;
let queue: Promise<unknown> = Promise.resolve();
const copy = (value: any) => value === undefined ? undefined : structuredClone(value);
const snapshot = (path: string) => ({ id: path.split('/').at(-1), ref: document(path), exists: docs.has(path),
  data: () => copy(docs.get(path)), get: (key: string) => copy(docs.get(path)?.[key]) });
const write = (path: string, data: any, merge = false) => {
  if (path.includes('/crmCustomers/') && failCrm) { failCrm = false; throw Error('CRM_TRANSIENT'); }
  docs.set(path, merge ? { ...docs.get(path), ...copy(data) } : copy(data));
};
const document = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path),
  collection: (name: string) => collection(`${path}/${name}`),
  create: async (data: any) => { assert(!docs.has(path)); write(path, data); },
  update: async (data: any) => { assert(docs.has(path)); write(path, data, true); },
  set: async (data: any, options: any) => write(path, data, options?.merge) });
const collection = (path: string, filters: Array<(d: any) => boolean> = []): any => ({
  doc: (id: string) => document(`${path}/${id}`),
  where: (key: string, op: string, value: any) => { assert.equal(op, '=='); return collection(path, [...filters, d => d[key] === value]); },
  get: async () => {
    const found = [...docs.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
      .filter(key => filters.every(filter => filter(docs.get(key)))).map(snapshot);
    return { docs: found, size: found.length, empty: found.length === 0 };
  },
});
const db = { doc: document, collection, runTransaction: async (callback: any) => {
  const result = queue.then(async () => {
    const writes: Array<() => void> = []; let writing = false;
    const output = await callback({
      get: async (ref: any) => { assert(!writing, 'all transaction reads precede writes'); return snapshot(ref.path); },
      create: (ref: any, value: any) => { writing = true; writes.push(() => { assert(!docs.has(ref.path), ref.path); write(ref.path, value); }); },
      set: (ref: any, value: any, options: any) => { writing = true; writes.push(() => write(ref.path, value, options?.merge)); },
      update: (ref: any, value: any) => { writing = true; writes.push(() => { assert(docs.has(ref.path), ref.path); write(ref.path, value, true); }); },
    });
    for (const execute of writes) execute();
    return output;
  });
  queue = result.catch(() => undefined); return result;
} };
const context = {
  db,
  auth: async (authorization: string) => { if (!authorization) throw Error('AUTH_REQUIRED'); return { uid: authorization, email: authorization + '@example.test', emailVerified: true }; },
  official: async () => ({ canonicalStoreId: 'official', ownerUserId: 'platform-owner', legacyStoreId: 'platform-owner' }),
  catalog: async () => ({ plans: [{ planId: 'pro', version: 2 }, { planId: 'business', version: 3 }] }),
  route: async (input: any) => {
    const mapping = docs.get(`${ROOT}/official_plan_products/${input.productId}`);
    if (input.sellerStoreReference !== 'official' || mapping?.status !== 'active') throw Error('INVALID_PLATFORM_PLAN_MAPPING');
    return { kind: 'platform-plan', plan: mapping.planId };
  },
  account: async () => collector,
  signature: (headers: any) => { if (headers['x-signature'] !== 'valid') throw Error('INVALID_SIGNATURE'); },
  request: async (path: string, init: any = {}) => {
    if (path === '/v1/payments' && init.method === 'POST') {
      posts++; const data = JSON.parse(init.body);
      const payment = { ...data, id: String(posts), collector_id: collector, currency_id: 'BRL', live_mode: true,
        status: 'pending', status_detail: 'pending_waiting_transfer',
        point_of_interaction: { transaction_data: { qr_code: 'PIX-TEST-ONLY' } } };
      payments.set(payment.id, payment);
      if (beforeResponse) await beforeResponse();
      if (lost) throw Error('LOST_RESPONSE');
      return copy(payment);
    }
    if (path.startsWith('/v1/payments/search?')) {
      const ref = new URLSearchParams(path.split('?')[1]).get('external_reference');
      const found = [...payments.values()].filter(p => p.external_reference === ref);
      return { paging: { total: found.length, limit: 2, offset: 0 }, results: copy(found) };
    }
    return copy(payments.get(path.split('/').at(-1)!));
  },
};
(globalThis as any).__officialPix = context;
const bundle = await build({ stdin: { contents: `export * from './server/payments/officialPlanPixCheckout.ts';
  export {loadVerifiedStoreSubscriptionPrepaidCoverage} from './server/payments/storeSubscriptionService.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-official-pix', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|consultantAuth\.js$|officialStoreService\.js$|publicPlanCatalogService\.js$|officialPlanProductLookup\.js$|officialPlanPixProvider\.js$|paidPlanSubscriptionService\.js$|mercadoPagoStoreOauthService\.js$|commercialRecipientAuthorityService\.js$|mercadoPagoPixProvider\.js$|^firebase-admin\/firestore$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      const prefix = 'const c=globalThis.__officialPix;';
      const source = args.path.endsWith('firebaseAdmin.js') ? 'export const adminDb=c.db;' :
        args.path.endsWith('consultantAuth.js') ? 'export const authenticateConsultantRequest=c.auth;' :
        args.path.endsWith('officialStoreService.js') ? 'export const getOfficialStoreIdentity=c.official;' :
        args.path.endsWith('publicPlanCatalogService.js') ? 'export const loadPublicActivePlanCatalog=c.catalog;' :
        args.path.endsWith('officialPlanProductLookup.js') ? 'export const resolvePersistedProductCheckoutRoute=c.route;' :
        args.path.endsWith('officialPlanPixProvider.js') ? 'export const officialPlanPixAccount=c.account, officialPlanPixRequest=c.request, verifyOfficialPlanPixSignature=c.signature;' :
        args.path.endsWith('paidPlanSubscriptionService.js') ? `export const writePlanMirrors=(tx,uid,storeId,plan,updatedAt)=>{for(const path of ['users/'+uid+'/stores/'+uid,'tenants/'+uid,'stores/'+storeId])tx.set(c.db.doc(path),{plan,updatedAt},{merge:true});};` :
        args.path.endsWith('mercadoPagoStoreOauthService.js') ? 'export const mercadoPagoStoreRequest=()=>{throw Error("MERCHANT_OAUTH_FORBIDDEN")};' :
        args.path.endsWith('commercialRecipientAuthorityService.js') ? 'export const resolveCommercialRecipientAuthority=()=>{throw Error("MERCHANT_ACCOUNT_FORBIDDEN")};' :
        args.path.endsWith('mercadoPagoPixProvider.js') ? 'export const verifyMercadoPagoWebhookSignature=()=>{throw Error("MERCHANT_WEBHOOK_FORBIDDEN")};' :
        'export const FieldValue={serverTimestamp:()=>"SERVER_TIME"},FieldPath={documentId:()=>"id"};';
      return { contents: prefix + source };
    });
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const modality = { schemaVersion: 1, mode: 'subscription', subscription: { schemaVersion: 1, autoRenew: true,
  billingInterval: { unit: 'month', count: 1 }, benefit: { kind: 'access', unitsPerCycle: null } } };
beforeEach(() => {
  posts = 0; payments = new Map(); lost = false; failCrm = false; beforeResponse = null; collector = '42'; queue = Promise.resolve();
  delete process.env.VERCEL_ENV;
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE = 'true';
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'buyer';
  delete process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_CHECKOUT_ID;
  docs = new Map([
    ['kyrub_admin/official_store', { canonicalStoreId: 'official' }],
    ['stores/official', { ownerId: 'platform-owner', legacyTenantId: 'platform-owner' }],
    ['stores/buyer-store', { ownerId: 'buyer', legacyTenantId: 'buyer', plan: 'free' }],
    ['users/buyer/stores/buyer', { plan: 'free' }],
    ['users/buyer', { displayName: 'Buyer' }],
    ['stores/official/products/pro-product', { name: 'Kyrub Pro', price: 20, publicationStatus: 'published', saleModality: modality, storePointsPerUnit: 7,
      contractDiscounts: [{ months: 1, discountPercent: 0 }, { months: 3, discountPercent: 10 }] }],
    [`${ROOT}/official_plan_products/pro-product`, { productId: 'pro-product', planId: 'pro', status: 'active', canonicalStoreId: 'official',
      rewards: { xp: 12, achievement: { id: 'member', title: 'Member', description: 'Paid membership', badgeId: 'member-badge' } } }],
  ]);
});
const quote = (months = 1) => api.quoteOfficialPlanPix({ authorization: 'buyer', storeId: 'official', productId: 'pro-product', selectedMonths: months });
async function accepted(months = 1) {
  const q = await quote(months);
  await api.acceptOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId, acceptedTotalMinor: q.quote.totalMinor });
  return q;
}
const approve = () => { const p = payments.get('1'); p.status = 'approved'; p.status_detail = 'accredited'; p.date_approved = new Date().toISOString(); };
const reconcile = (checkoutId: string) => api.reconcileOfficialPlanPix({ authorization: 'buyer', checkoutId });
const webhook = (checkoutId: string, signature = 'valid') => api.handleOfficialPlanPixWebhook({ headers: { 'x-signature': signature }, checkoutId, dataId: '1' });
const count = (segment: string) => [...docs.keys()].filter(path => path.includes(segment)).length;

test('monthly platform Pix activates canonical contract, access, CRM, finance, configured XP, points, badge and benefits exactly once', async () => {
  const q = await accepted();
  const pending = await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId });
  assert.equal(pending.state, 'awaiting_payment'); assert.equal(posts, 1);
  assert(!docs.has(`${ROOT}/store_entitlements/buyer`)); assert.equal(count('/economicLedger/'), 0);
  approve();
  const result = await webhook(q.checkoutId);
  assert.equal(result.state, 'activated');
  await webhook(q.checkoutId); await reconcile(q.checkoutId);
  assert.equal(posts, 1); assert.equal(docs.get('stores/buyer-store').plan, 'pro');
  assert.equal(docs.get(`${ROOT}/store_entitlements/buyer`).benefitEndsAt, result.expiresAt);
  assert.equal(count('/economicLedger/'), 1); assert.equal(count('/payments/'), 1); assert.equal(count('/storePointLedger/'), 1);
  assert.equal(count('/xpLedger/'), 1); assert.equal(count('/achievements/'), 1); assert.equal(count('/prepaidSubscriptionContracts/'), 1);
  assert.equal(count('/benefitCycles/'), 1);
  assert.equal(docs.get('stores/official/crmCustomers/buyer').subscriptionStats.activeSubscriptionCount, 1);
  const coverage = await api.loadVerifiedStoreSubscriptionPrepaidCoverage({ id: result.subscriptionId, storeId: 'official', buyerId: 'buyer', productId: 'pro-product' }, Date.parse(result.startsAt) + 1);
  assert.equal(coverage.current.contractId, result.contractId);
  assert.equal(docs.get('users/buyer/achievements/member').badgeId, 'member-badge');
});

test('lost POST response is recovered by reference without sending a second payment', async () => {
  const q = await accepted(3); assert.equal(q.quote.totalMinor, 5400);
  lost = true;
  assert.equal((await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId })).state, 'recovery_required');
  assert.equal((await reconcile(q.checkoutId)).state, 'awaiting_payment');
  assert.equal((await quote(1)).checkoutId, q.checkoutId);
  approve(); assert.equal((await webhook(q.checkoutId)).state, 'activated'); assert.equal(posts, 1);
});

test('early webhook can finish before the payment creation response without regressing activation', async () => {
  const q = await accepted();
  beforeResponse = async () => { approve(); assert.equal((await webhook(q.checkoutId)).state, 'activated'); };
  assert.equal((await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId })).state, 'activated');
  assert.equal(count('/economicLedger/'), 1); assert.equal(posts, 1);
});

test('concurrent accepted quotes cannot create two payments for the buyer', async () => {
  const one = await accepted(), two = await accepted();
  const results = await Promise.allSettled([one, two].map(q => api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId })));
  assert.equal(posts, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('disabled creation still allows reconciliation and retry-safe completion of projections', async () => {
  const q = await accepted(); process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'false';
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }), /DISABLED/); assert.equal(posts, 0);
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'true';
  await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }); approve(); failCrm = true;
  await assert.rejects(webhook(q.checkoutId), /CRM_TRANSIENT/);
  assert.equal(docs.get(`${ROOT}/plan_pix_checkouts/${q.checkoutId}`).effectsStatus, 'pending');
  process.env.KYRUB_OFFICIAL_PLAN_PIX_CHECKOUT_ENABLED = 'false';
  assert.equal((await reconcile(q.checkoutId)).state, 'activated');
  assert.equal(count('/xpLedger/'), 1); assert.equal(count('/storePointLedger/'), 1); assert.equal(count('/economicLedger/'), 1); assert.equal(posts, 1);
});

test('rejects catalog drift, buyer substitution, unsigned webhook and mismatched provider collector/amount/reference/live mode', async () => {
  const q = await accepted();
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'other', checkoutId: q.checkoutId }), /FORBIDDEN/);
  docs.get('stores/official/products/pro-product').price = 21;
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }), /OFFER_CHANGED/); assert.equal(posts, 0);
  docs.get('stores/official/products/pro-product').price = 20;
  await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }); approve();
  await assert.rejects(webhook(q.checkoutId, 'invalid'), /SIGNATURE/);
  const original = copy(payments.get('1'));
  for (const patch of [{ collector_id: 'other' }, { transaction_amount: 19 }, { external_reference: 'other' }, { live_mode: false }, { transaction_amount_refunded: 1 }, { status_detail: 'pending' }, { date_approved: 'invalid' }]) {
    process.env.VERCEL_ENV = 'production'; payments.set('1', { ...original, ...patch }); await assert.rejects(webhook(q.checkoutId));
    assert(!docs.has(`${ROOT}/store_entitlements/buyer`));
  }
  assert.equal(count('/economicLedger/'), 0);
});

test('Firestore key ordering does not invalidate accepted quote, and definitive rejection permits a fresh quote', async () => {
  const q = await accepted();
  const d = docs.get(`${ROOT}/plan_pix_checkouts/${q.checkoutId}`);
  d.offer = Object.fromEntries(Object.entries(d.offer).reverse());
  await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId });
  payments.get('1').status = 'rejected'; assert.equal((await reconcile(q.checkoutId)).state, 'rejected');
  assert.notEqual((await quote()).checkoutId, q.checkoutId); assert.equal(count('/prepaidSubscriptionContracts/'), 0);
});

test('a globally bound provider payment cannot be materialized for another contract', async () => {
  const q = await accepted(); await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }); approve();
  const binding = 'prepaidRenewalPaymentBindings/' + createHash('sha256').update('mercado_pago:1').digest('hex');
  docs.set(binding, { contractPath: 'stores/other/prepaidSubscriptionContracts/other' });
  await assert.rejects(webhook(q.checkoutId), /PAYMENT_ALREADY_USED/); assert.equal(count('/economicLedger/'), 0);
});

test('Business follows configured prices and discounts; missing rewards produce no fabricated grants', async () => {
  const p = docs.get('stores/official/products/pro-product');
  p.price = 67.89; delete p.storePointsPerUnit;
  const mapping = docs.get(`${ROOT}/official_plan_products/pro-product`); mapping.planId = 'business'; delete mapping.rewards;
  const q = await accepted(3); assert.equal(q.quote.totalMinor, 18330);
  await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }); approve();
  const result = await webhook(q.checkoutId);
  assert.equal(result.state, 'activated'); assert.equal(docs.get('stores/buyer-store').plan, 'business');
  assert.equal(docs.get(`${ROOT}/store_entitlements/buyer`).planVersion, 3);
  assert.equal(count('/xpLedger/'), 0); assert.equal(count('/storePointLedger/'), 0); assert.equal(count('/achievements/'), 0);
});


test('pilot rejects unauthorized buyer before provider POST', async () => {
  const q = await accepted();
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'someone-else';
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId }), /PILOT_FORBIDDEN/);
  assert.equal(posts, 0);
});

test('pilot rejects another plan term or price and rejects missing pilot configuration', async () => {
  const longer = await accepted(3);
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: longer.checkoutId }), /PILOT_OFFER_FORBIDDEN/);
  assert.equal(posts, 0);
  const monthly = await accepted();
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = '';
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: monthly.checkoutId }), /PILOT_FORBIDDEN/);
  process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_BUYER_UID = 'buyer';
  delete process.env.KYRUB_OFFICIAL_PLAN_PIX_PILOT_MODE;
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: monthly.checkoutId }), /PILOT_MODE_REQUIRED/);
  assert.equal(posts, 0);
});

test('pilot reservation is consumed once, including after a definitively rejected charge', async () => {
  const q = await accepted();
  const first = await api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: q.checkoutId });
  assert.equal(first.state, 'awaiting_payment');
  assert.equal(posts, 1);
  payments.get('1').status = 'rejected';
  assert.equal((await reconcile(q.checkoutId)).state, 'rejected');
  const next = await accepted();
  await assert.rejects(api.checkoutOfficialPlanPix({ authorization: 'buyer', checkoutId: next.checkoutId }), /PILOT_ALREADY_USED/);
  assert.equal(posts, 1);
});
