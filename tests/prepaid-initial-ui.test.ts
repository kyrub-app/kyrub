import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const auth = { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } };
(globalThis as any).__initialUiAuth = auth;
const clientBundle = await build({ entryPoints: ['src/utils/storeSubscription.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'no-firebase-network', setup(b) {
    b.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const auth=globalThis.__initialUiAuth;' }));
  } }],
});
const client = await import('data:text/javascript;base64,' + Buffer.from(clientBundle.outputFiles[0].text).toString('base64'));
const uiBundle = await build({ entryPoints: ['src/components/InitialPrepaidSubscriptionCheckout.tsx'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'no-business-service', setup(b) {
    b.onResolve({ filter: /firebase\/auth|\.\.\/utils\// }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const auth={currentUser:null};export const onAuthStateChanged=()=>()=>{};
      export const quoteInitialPrepaidSubscription=()=>{};export const acceptInitialPrepaidSubscription=()=>{};export const checkoutInitialPrepaidSubscription=()=>{};export const loadInitialPrepaidSubscriptionStatus=()=>{};` }));
  } }],
});
const { InitialPrepaidSubscriptionCard: Card } = await import('data:text/javascript;base64,' + Buffer.from(uiBundle.outputFiles[0].text).toString('base64'));
const quote = { checkoutId: 'a'.repeat(64), quote: { months: 3, discountPercent: 10, totalMinor: 27000, monthlyEquivalentMinor: 9000 } };
const render = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Card, {
  quote, payment: null, accepted: false, busy: false, error: '', selectedMonths: 3, onAccept() {}, onAction() {}, ...extra,
}));

test('first prepaid purchase requires an explicit total acceptance and describes one Pix charge', () => {
  const html = render();
  assert.match(html, /sem parcelamento e sem renovação automática/);
  assert.match(html, /Confirmo a contratação de 3 meses/);
  assert.match(html, /Confirmar contratação e gerar Pix/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(render({ accepted: true }), /disabled=""/);
});
test('pending Pix never means active; confirmed coverage only comes from server result', () => {
  const pending = render({ payment: { state: 'awaiting_payment', pix: { qrCode: 'isolated-pix', expiresAt: '2099-01-01T00:00:00Z' } } });
  assert.match(pending, /Aguardando pagamento Pix/); assert.match(pending, /isolated-pix/);
  assert.doesNotMatch(pending, /contrato ativos/); assert.doesNotMatch(pending, /Confirmar contratação/);
  const active = render({ payment: { state: 'activated', subscriptionId: 'sub-a', contractId: 'contract-a', startsAt: '2026-01-01T00:00:00Z', expiresAt: '2026-04-01T00:00:00Z' } });
  assert.match(active, /Assinatura e contrato ativos/); assert.match(active, /Vigência/);
  assert.doesNotMatch(active, /Consultar pagamento existente/);
});
test('resumed checkout displays original server term instead of a different cart selection', () => {
  const html = render({ selectedMonths: 6, quote: { ...quote, status: 'accepted' } });
  assert.match(html, /Contrato de 3 meses/); assert.doesNotMatch(html, /Contrato de 6 meses/);
  assert.match(html, /Continuar contratação já aceita/);
});
test('rejected, expired and unknown payment states do not offer another charge', () => {
  for (const payment of [{ state: 'rejected' }, { state: 'recovery_required' }, { state: 'awaiting_payment', pix: { qrCode: 'expired-pix', expiresAt: '2000-01-01T00:00:00Z' } }]) {
    const html = render({ payment }); assert.match(html, /Consultar pagamento existente/);
    assert.doesNotMatch(html, /Confirmar contratação/); assert.doesNotMatch(html, /expired-pix/);
  }
});
test('client separates quote, explicit acceptance, checkout and read-only status with minimal payloads', async () => {
  auth.currentUser = { uid: 'buyer', getIdToken: async () => 'isolated-token' };
  const calls: Array<{ url: string; body: unknown }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init!.body as string) }); return Response.json({ state: 'awaiting_payment' }); };
  try {
    await client.quoteInitialPrepaidSubscription({ storeId: ' store-a ', productId: ' product ', selectedMonths: 3 });
    await client.acceptInitialPrepaidSubscription({ storeId: 'store-a', checkoutId: 'intent', acceptedTotalMinor: 27000 });
    await client.checkoutInitialPrepaidSubscription({ storeId: 'store-a', checkoutId: 'intent' });
    await client.loadInitialPrepaidSubscriptionStatus({ storeId: 'store-a', checkoutId: 'intent' });
    assert.deepEqual(calls.map(c => c.url.split('op=')[1]), ['merchant.prepaid-initial.quote', 'merchant.prepaid-initial.accept', 'merchant.prepaid-initial.checkout', 'merchant.prepaid-initial.payment-status']);
    assert.deepEqual(calls[0].body, { storeId: 'store-a', productId: 'product', selectedMonths: 3 });
    assert.deepEqual(calls[1].body, { storeId: 'store-a', checkoutId: 'intent', acceptedTotalMinor: 27000 });
    for (const call of calls.slice(2)) assert.deepEqual(call.body, { storeId: 'store-a', checkoutId: 'intent' });
  } finally { globalThis.fetch = previous; }
});
test('session switch during token acquisition prevents a charge request', async () => {
  let resolve!: (s: string) => void;
  auth.currentUser = { uid: 'buyer-a', getIdToken: () => new Promise(r => { resolve = r; }) };
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    const request = client.checkoutInitialPrepaidSubscription({ storeId: 'store-a', checkoutId: 'intent' });
    auth.currentUser = { uid: 'buyer-b', getIdToken: async () => 'other' }; resolve('old');
    await assert.rejects(request, /Sua conta mudou/); assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});
test('actual cart mounts the prepaid flow and preserves the legacy recurring guard', () => {
  const source = readFileSync('src/components/modals/B2CCartDrawerApprovalBase.tsx', 'utf8');
  assert.match(source, /<InitialPrepaidSubscriptionCheckout storeId=\{visitingStore.id\} productId=\{cart\[0\].product.id\}/);
  assert.match(source, /subscriptions\[0\].product.contractDiscounts !== undefined/);
  assert.match(source, /subscriptionMonths !== 1/);
});

// Execute the real session callbacks with controlled hooks and deferred services.
const fixture: any = { states: [], refs: [], stateCursor: 0, refCursor: 0, effects: [], calls: [], auth, accept: null };
fixture.useState = (value: unknown) => { const i = fixture.stateCursor++; if (!(i in fixture.states)) fixture.states[i] = value; return [fixture.states[i], (next: any) => { fixture.states[i] = typeof next === 'function' ? next(fixture.states[i]) : next; }]; };
fixture.useRef = (value: unknown) => { const i = fixture.refCursor++; return fixture.refs[i] ??= { current: value }; };
(globalThis as any).__initialUiHooks = fixture;
const sessionBundle = await build({ entryPoints: ['src/components/InitialPrepaidSubscriptionCheckout.tsx'], bundle: true, platform: 'node', format: 'esm', write: false, define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'controlled-hook-session', setup(b) {
    b.onResolve({ filter: /^react$|firebase\/auth|\.\.\/utils\// }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'react' ? `const h=globalThis.__initialUiHooks;export const useState=(v)=>h.useState(v);export const useRef=(v)=>h.useRef(v);export const useEffect=(f)=>h.effects.push(f());` : a.path.includes('storeSubscription') ? `const h=globalThis.__initialUiHooks;export const quoteInitialPrepaidSubscription=async()=>{h.calls.push('quote');return h.quote;};export const acceptInitialPrepaidSubscription=async()=>{h.calls.push('accept');await h.accept;};export const checkoutInitialPrepaidSubscription=async()=>{h.calls.push('checkout');return {state:'awaiting_payment'};};export const loadInitialPrepaidSubscriptionStatus=async()=>{h.calls.push('status');return {state:'recovery_required'};};` : `export const auth=globalThis.__initialUiHooks.auth;export const onAuthStateChanged=()=>()=>{};` }));
  } }],
});
const { InitialPrepaidSubscriptionSession: Session } = await import('data:text/javascript;base64,' + Buffer.from(sessionBundle.outputFiles[0].text).toString('base64'));
const draw = () => { fixture.stateCursor = 0; fixture.refCursor = 0; return Session({ storeId: 'store-a', productId: 'product', selectedMonths: 3, buyerUid: 'buyer-a' }); };
const reset = () => { fixture.states = [quote, true, null, false, '']; fixture.refs = []; fixture.effects = []; fixture.calls = []; fixture.accept = Promise.resolve(); fixture.quote = quote; auth.currentUser = { uid: 'buyer-a', getIdToken: async () => 'token' }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
test('session records explicit acceptance before Pix creation', async () => {
  reset(); draw().props.onAction('checkout'); await flush();
  assert.deepEqual(fixture.calls, ['accept', 'checkout']); assert.equal(fixture.states[2].state, 'awaiting_payment');
});
test('unchecked acceptance cannot create Pix even through a direct callback', async () => {
  reset(); fixture.states[1] = false; draw().props.onAction('checkout'); await flush();
  assert.deepEqual(fixture.calls, []);
});
test('switching UID while acceptance is pending prevents checkout and stale data writes', async () => {
  reset(); let finish!: () => void; fixture.accept = new Promise<void>(r => { finish = r; });
  draw().props.onAction('checkout'); auth.currentUser = { uid: 'buyer-b', getIdToken: async () => 'other' }; finish(); await flush();
  assert.deepEqual(fixture.calls, ['accept']); assert.equal(fixture.states[2], null);
});
test('unmounting for another store discards a deferred acceptance response', async () => {
  reset(); let finish!: () => void; fixture.accept = new Promise<void>(r => { finish = r; });
  draw().props.onAction('checkout'); fixture.effects[0](); finish(); await flush();
  assert.deepEqual(fixture.calls, ['accept']); assert.equal(fixture.states[2], null);
});
test('reopening a bound checkout resumes only status without accepting or charging again', async () => {
  reset(); fixture.states[0] = null; fixture.quote = { ...quote, status: 'bound' };
  draw().props.onAction('quote'); await flush();
  assert.deepEqual(fixture.calls, ['quote', 'status']); assert.equal(fixture.states[2].state, 'recovery_required');
});
