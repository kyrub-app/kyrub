import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const auth = { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } };
(globalThis as any).__renewalUiAuth = auth;
const clientBundle = await build({ entryPoints: ['src/utils/storeSubscription.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'firebase-session-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const auth=globalThis.__renewalUiAuth;' }));
  } }],
});
const client = await import('data:text/javascript;base64,' + Buffer.from(clientBundle.outputFiles[0].text).toString('base64'));
const cardBundle = await build({ entryPoints: ['src/components/CustomerStoreRelationshipPanel.tsx'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'no-business-services', setup(plugin) {
    plugin.onResolve({ filter: /^(firebase\/auth|\.\.\/utils\/)/ }, args => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const auth={currentUser:null}; export const onAuthStateChanged=()=>()=>{};
      export const acceptMerchantPrepaidRenewal=()=>{}; export const checkoutMerchantPrepaidRenewal=()=>{};
      export const listMyMerchantPrepaidRenewalProposals=()=>{}; export const loadMerchantPrepaidRenewalPaymentStatus=()=>{};
      export const redeemStoreRewardForCurrentUser=()=>{}; export const loadStoreRelationshipForCurrentUser=()=>{};` }));
  } }],
});
const { PrepaidRenewalOfferCard: Card } = await import('data:text/javascript;base64,' + Buffer.from(cardBundle.outputFiles[0].text).toString('base64'));
const offer = { id: 'a'.repeat(64), status: 'accepted', proposal: { storeId: 'store-a', productId: 'product-a', previousContractId: 'contract-a', months: 12, currentMonthlyPriceMinor: 19990, discountPercent: 0, totalDueMinor: 239880 } };
const render = (payment?: unknown, extra = {}) => renderToStaticMarkup(createElement(Card, { offer: { ...offer, ...extra }, payment, busyId: '', onAccept() {}, onPayment() {} }));

test('UI distinguishes acceptance, unpaid, confirmed and activated coverage', () => {
  assert.match(render(undefined, { status: 'awaiting_acceptance' }), /Aceitar condições/);
  assert.match(render(), /Gerar Pix da renovação/);
  const pending = render({ state: 'awaiting_payment', pix: { qrCode: 'synthetic-pix', expiresAt: '2099-01-01T00:00:00Z' } });
  assert.match(pending, /Aguardando pagamento/); assert.match(pending, /synthetic-pix/);
  assert.doesNotMatch(pending, /Contrato ativado/);
  assert.match(render({ state: 'payment_confirmed' }), /Concluindo a ativação/);
  const active = render({ state: 'activated', contract: { contractId: 'new', startsAt: '2028-01-01T00:00:00Z', expiresAt: '2029-01-01T00:00:00Z' } });
  assert.match(active, /Contrato ativado/); assert.match(active, /Vigência/); assert.doesNotMatch(active, /Gerar Pix/);
});

test('expired or ambiguous attempts offer reconciliation without another checkout', () => {
  for (const payment of [{ state: 'recovery_required' }, { state: 'awaiting_payment', pix: { qrCode: 'expired-code', expiresAt: '2000-01-01T00:00:00Z' } }]) {
    const html = render(payment);
    assert.match(html, /Consultar pagamento existente/); assert.doesNotMatch(html, /Gerar Pix/); assert.doesNotMatch(html, /expired-code/);
  }
});

test('authoritative listing activation is rendered after session reload', () => {
  const html = render(undefined, { renewalState: 'activated', contract: { contractId: 'new', startsAt: '2028-01-01T00:00:00Z', expiresAt: '2029-01-01T00:00:00Z' } });
  assert.match(html, /Contrato ativado/); assert.doesNotMatch(html, /Gerar Pix/);
  assert.match(render({ state: 'awaiting_payment' }, { renewalState: 'activated' }), /Contrato ativado/);
});

test('checkout and status client send only scoped server identifiers', async () => {
  auth.currentUser = { uid: 'buyer-a', getIdToken: async () => 'synthetic-token' };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return Response.json({ state: 'awaiting_payment' }); };
  try {
    await client.checkoutMerchantPrepaidRenewal({ storeId: ' store-a ', proposalId: ' proposal-a ' });
    await client.loadMerchantPrepaidRenewalPaymentStatus({ storeId: 'store-a', proposalId: 'proposal-a' });
    assert(calls[0].url.endsWith('merchant.prepaid-renewal.checkout'));
    assert(calls[1].url.endsWith('merchant.prepaid-renewal.payment-status'));
    for (const call of calls) assert.deepEqual(JSON.parse(call.init.body as string), { storeId: 'store-a', proposalId: 'proposal-a' });
  } finally { globalThis.fetch = previous; }
});

test('changing signed-in UID during token acquisition prevents the request', async () => {
  let resolveToken!: (token: string) => void;
  auth.currentUser = { uid: 'buyer-a', getIdToken: () => new Promise(resolve => { resolveToken = resolve; }) };
  const previous = globalThis.fetch; let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('Unexpected network request'); };
  try {
    const pending = client.checkoutMerchantPrepaidRenewal({ storeId: 'store-a', proposalId: 'proposal-a' });
    auth.currentUser = { uid: 'buyer-b', getIdToken: async () => 'other' };
    resolveToken('old-token');
    await assert.rejects(pending, /Sua conta mudou/); assert.equal(fetched, false);
  } finally { globalThis.fetch = previous; }
});

test('reconciliation preserves the actual already_recorded server result', async () => {
  auth.currentUser = { uid: 'buyer-a', getIdToken: async () => 'synthetic-token' };
  const previous = globalThis.fetch; globalThis.fetch = async () => Response.json({ status: 'already_recorded' });
  try { assert.equal((await client.reconcileMerchantPrepaidRenewal({ storeId: 'store-a', proposalId: 'proposal-a', paymentId: '123' })).status, 'already_recorded'); }
  finally { globalThis.fetch = previous; }
});

test('relationship data is remounted for UID/store changes and async writes are guarded', () => {
  const source = readFileSync('src/components/CustomerStoreRelationshipPanel.tsx', 'utf8');
  assert.match(source, /key=\{JSON\.stringify\(\[identity\.uid, props\.storeId\]\)\}/);
  assert.match(source, /mounted\.current && auth\.currentUser\?\.uid === buyerUid/);
  assert.match(source, /if \(!isCurrentSession\(\)\) return;/);
  assert.match(source, /if \(isCurrentSession\(\)\) setRenewalOffers/);
});

// Execute the real component callbacks with controllable hook/service boundaries.
// This checks deferred responses without requiring a browser or Firebase session.
const hooks = { identity: { ready: true, uid: 'buyer-a' as string | null }, inner: false, writes: [] as unknown[], cleanups: [] as Array<() => void | (() => void)>, offers: [offer] };
let finishAcceptance!: () => void;
let listCalls = 0;
(globalThis as any).__renewalHooks = hooks;
(globalThis as any).__renewalUiServices = {
  accept: () => new Promise<void>(resolve => { finishAcceptance = resolve; }),
  list: async () => { listCalls += 1; return { proposals: [offer] }; },
};
const callbackBundle = await build({ entryPoints: ['src/components/CustomerStoreRelationshipPanel.tsx'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'controlled-hooks', setup(plugin) {
    plugin.onResolve({ filter: /^(react|react\/jsx-runtime|firebase\/auth|lucide-react|\.\.\/utils\/)/ }, args => ({ path: args.path, namespace: 'callbacks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'callbacks' }, args => ({ contents: args.path === 'react'
      ? `export const useState=(initial)=>{ const h=globalThis.__renewalHooks; return [!h.inner ? h.identity : Array.isArray(initial) ? h.offers : initial, value=>h.writes.push(value)]; };
         export const useEffect=(callback)=>{const cleanup=callback; globalThis.__renewalHooks.cleanups.push(cleanup);};
         export const useRef=(current)=>({current}); export const useCallback=fn=>fn; export const useMemo=fn=>fn();`
      : args.path === 'react/jsx-runtime' ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx;'
      : args.path === 'lucide-react' ? 'export const Award=()=>null,ChevronDown=Award,ChevronUp=Award,Gift=Award,History=Award,LoaderCircle=Award,RefreshCw=Award,Sparkles=Award,Target=Award,TicketCheck=Award,Trophy=Award;'
      : `export const auth=globalThis.__renewalUiAuth; export const onAuthStateChanged=()=>()=>{};
         export const acceptMerchantPrepaidRenewal=(...args)=>globalThis.__renewalUiServices.accept(...args);
         export const listMyMerchantPrepaidRenewalProposals=(...args)=>globalThis.__renewalUiServices.list(...args);
         export const checkoutMerchantPrepaidRenewal=()=>{}; export const loadMerchantPrepaidRenewalPaymentStatus=()=>{};
         export const redeemStoreRewardForCurrentUser=()=>{}; export const loadStoreRelationshipForCurrentUser=()=>{};` }));
  } }],
});
const callbacks = await import('data:text/javascript;base64,' + Buffer.from(callbackBundle.outputFiles[0].text).toString('base64'));
const findOfferCard = (tree: any): any => {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === callbacks.PrepaidRenewalOfferCard) return tree;
  for (const child of [tree.props?.children].flat(3)) { const found = findOfferCard(child); if (found) return found; }
  return null;
};

test('actual component keys customer state separately for each UID and store', () => {
  hooks.inner = false;
  hooks.identity = { ready: true, uid: 'buyer-a' };
  const a = callbacks.CustomerStoreRelationshipPanel({ storeId: 'store-a', storeName: 'A' });
  hooks.identity = { ready: true, uid: 'buyer-b' };
  const b = callbacks.CustomerStoreRelationshipPanel({ storeId: 'store-a', storeName: 'A' });
  const c = callbacks.CustomerStoreRelationshipPanel({ storeId: 'store-b', storeName: 'B' });
  assert.notEqual(a.key, b.key); assert.notEqual(b.key, c.key);
});

test('actual acceptance handler discards delayed response after UID change', async () => {
  hooks.inner = false; hooks.identity = { ready: true, uid: 'buyer-a' };
  const outer = callbacks.CustomerStoreRelationshipPanel({ storeId: 'store-a', storeName: 'A' });
  hooks.inner = true; hooks.writes = []; hooks.cleanups = []; listCalls = 0;
  auth.currentUser = { uid: 'buyer-a', getIdToken: async () => 'synthetic' };
  const tree = outer.type(outer.props);
  const card = findOfferCard(tree); assert(card);
  card.props.onAccept(offer.id, offer.proposal.totalDueMinor);
  const before = hooks.writes.length;
  auth.currentUser = { uid: 'buyer-b', getIdToken: async () => 'synthetic' };
  finishAcceptance();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listCalls, 0); assert.equal(hooks.writes.length, before);
});

test('actual acceptance handler discards response after old store unmounts', async () => {
  hooks.inner = false; hooks.identity = { ready: true, uid: 'buyer-a' };
  const outer = callbacks.CustomerStoreRelationshipPanel({ storeId: 'store-a', storeName: 'A' });
  hooks.inner = true; hooks.writes = []; hooks.cleanups = []; listCalls = 0;
  auth.currentUser = { uid: 'buyer-a', getIdToken: async () => 'synthetic' };
  const tree = outer.type(outer.props);
  // The first effect owns this keyed customer session's mount lifetime.
  const unmount = hooks.cleanups[0]();
  const card = findOfferCard(tree); card.props.onAccept(offer.id, offer.proposal.totalDueMinor);
  const before = hooks.writes.length;
  assert.equal(typeof unmount, 'function');
  if (typeof unmount !== 'function') throw new Error('Missing session cleanup');
  unmount(); finishAcceptance();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listCalls, 0); assert.equal(hooks.writes.length, before);
});
