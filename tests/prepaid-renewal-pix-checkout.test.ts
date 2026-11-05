import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const storeId = 'canonical-store';
const proposalId = 'a'.repeat(64);
const input = { authorization: 'Bearer buyer', storeId, proposalId };
const calls: string[] = [];
let docs: Map<string, Record<string, unknown>>;
let payment: Record<string, unknown>;
let executionFailure: Error | undefined;
let activationFailure: Error | undefined;
let searchFailure: Error | undefined;
let authBuyer = 'buyer';
const attemptPath = `stores/${storeId}/prepaidRenewalPixAttempts/${proposalId}`;
const stored = { proposal: { previousContractId: 'old', totalDueMinor: 12000, productId: 'product', months: 12, currentMonthlyPriceMinor: 1000, discountPercent: 0 }, acceptance: { customerId: 'buyer', acceptedAt: '2026-01-01T00:00:00Z' } };
const expiry = () => new Date(Date.now() + 30 * 60_000).toISOString();
const request = () => ({ path: '/v1/payments', init: { method: 'POST', headers: { 'X-Idempotency-Key': `prepaid-renewal-${proposalId}` }, body: JSON.stringify({ transaction_amount: 120, date_of_expiration: expiry(), external_reference: `kyrub:prepaid-renewal:${storeId}:${proposalId}` }) } });
const snap = (path: string) => ({ exists: docs.has(path), ref: { path }, data: () => docs.get(path), get: (key: string) => docs.get(path)?.[key] });
const mock = (name: string, value: unknown) => {
  calls.push(name);
  if (name === 'authenticateConsultantRequest') { if (value !== 'Bearer buyer') throw new Error('AUTH_REQUIRED'); return { uid: authBuyer }; }
  if (name === 'loadAcceptedPrepaidRenewal') { if ((value as { authenticatedBuyerId: string }).authenticatedBuyerId !== 'buyer') throw new Error('RENEWAL_ACCEPTANCE_REQUIRED'); return stored; }
  if (name === 'prepareAuthenticatedPrepaidRenewalPixWithRecipient') return { request: request(), recipient: { credentialScopeId: 'owner-not-store', externalAccountId: '42' } };
  if (name === 'getValidMercadoPagoStoreAccessToken') return { externalAccountId: '42' };
  if (name === 'executeAuthenticatedLockedIsolatedPrepaidRenewalPix') { if (executionFailure) throw executionFailure; docs.set(attemptPath, { providerPaymentId: '123', executionState: 'in_flight' }); return { paymentId: '123', binding: 'bound' }; }
  if (name === 'reconcileUnknownSellerPrepaidRenewalPixPayment') { if (searchFailure) throw searchFailure; docs.set(attemptPath, { providerPaymentId: '123', executionState: 'outcome_unknown' }); return 'bound'; }
  if (name === 'mercadoPagoStoreRequest') return payment;
  if (name === 'validatePrepaidRenewalPixCreationResponse') { if (payment.collector_id !== 42) throw new Error('RENEWAL_PIX_CREATION_RESPONSE_MISMATCH'); return '123'; }
  if (name === 'verifyPrepaidRenewalMercadoPagoPayment') { if (payment.status_detail !== 'accredited') throw new Error('RENEWAL_PROVIDER_PAYMENT_MISMATCH'); return { id: '123', verifiedByProvider: true }; }
  if (name === 'recordPrepaidRenewalWithVerifiedSources') {
    if (activationFailure) throw activationFailure;
    const contractId = 'renewal-' + createHash('sha256').update(JSON.stringify([storeId, proposalId, '123'])).digest('hex');
    const contractPath = `stores/${storeId}/prepaidSubscriptionContracts/${contractId}`;
    docs.set(contractPath, { contractId, storeId, customerId: 'buyer', previousContractId: 'old', providerPaymentId: '123', totalPaidMinor: 12000, startsAt: '2027-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', productId: 'product', months: 12, monthlyBasePriceMinor: 1000, discountPercent: 0, acceptedAt: stored.acceptance.acceptedAt });
    docs.set(`prepaidRenewalPaymentBindings/${createHash('sha256').update('mercado_pago:123').digest('hex')}`, { contractPath, storeId, providerPaymentId: '123', provider: 'mercado_pago', contractId });
    docs.set(`stores/${storeId}/prepaidRenewalSuccessors/old`, { contractId, providerPaymentId: '123' });
    return 'created';
  }
  throw new Error('UNEXPECTED_MOCK:' + name);
};
(globalThis as any).__renewalCheckoutMock = mock;
(globalThis as any).__renewalCheckoutDb = { doc: (path: string) => ({ get: async () => snap(path) }) };
const imports: Record<string, string[]> = {
  'consultantAuth.js': ['authenticateConsultantRequest'],
  'mercadoPagoStoreOauthService.js': ['getValidMercadoPagoStoreAccessToken', 'mercadoPagoStoreRequest'],
  'prepaidRenewalCheckoutPreparation.js': ['prepareAuthenticatedPrepaidRenewalPixWithRecipient'],
  'prepaidRenewalActivation.js': ['loadAcceptedPrepaidRenewal', 'recordPrepaidRenewalWithVerifiedSources'],
  'prepaidRenewalPixLockedExecution.js': ['executeAuthenticatedLockedIsolatedPrepaidRenewalPix'],
  'prepaidRenewalPixSellerReconciliation.js': ['reconcileUnknownSellerPrepaidRenewalPixPayment'],
  'prepaidRenewalPixCreationResponse.js': ['validatePrepaidRenewalPixCreationResponse'],
  'prepaidRenewalPaymentVerification.js': ['verifyPrepaidRenewalMercadoPagoPayment'],
};
const bundle = await build({ entryPoints: ['server/payments/prepaidRenewalPixCheckout.ts'], write: false, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'isolated', setup(plugin) {
  plugin.onResolve({ filter: /^\.\.?\// }, args => {
    const file = args.path.split('/').at(-1)!;
    return imports[file] || file === 'firebaseAdmin.js' ? { path: file, namespace: 'stub' } : undefined;
  });
  plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'firebaseAdmin.js'
    ? 'export const adminDb=globalThis.__renewalCheckoutDb'
    : imports[args.path].map(name => `export const ${name}=(input,...rest)=>globalThis.__renewalCheckoutMock('${name}', input, ...rest)`).join('\n') }));
} }] });
const service = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
beforeEach(() => {
  docs = new Map(); calls.length = 0; executionFailure = activationFailure = searchFailure = undefined; authBuyer = 'buyer';
  payment = { id: 123, status: 'pending', status_detail: 'pending_waiting_payment', collector_id: 42, point_of_interaction: { transaction_data: { qr_code: 'PIX-CODE', qr_code_base64: 'YWJj' } } };
  delete process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED;
});
test('checkout is disabled by default before any effect', async () => {
  await assert.rejects(service.checkoutAuthenticatedPrepaidRenewalPix(input), /CHECKOUT_DISABLED/);
  assert.equal(calls.length, 0);
});
test('checkout returns validated Pix instructions and uses existing locked executor', async () => {
  process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED = 'true';
  const result = await service.checkoutAuthenticatedPrepaidRenewalPix(input);
  assert.equal(result.state, 'awaiting_payment'); assert.equal(result.pix.qrCode, 'PIX-CODE');
  assert.equal(calls.filter(name => name === 'executeAuthenticatedLockedIsolatedPrepaidRenewalPix').length, 1);
});
test('a bound retry only retrieves the existing payment without invoking creation', async () => {
  process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED = 'true';
  docs.set(attemptPath, { providerPaymentId: '123', executionState: 'in_flight' });
  assert.equal((await service.checkoutAuthenticatedPrepaidRenewalPix(input)).state, 'awaiting_payment');
  assert(!calls.includes('executeAuthenticatedLockedIsolatedPrepaidRenewalPix'));
});
test('unknown result recovers through existing seller search and never creation', async () => {
  docs.set(attemptPath, { executionState: 'outcome_unknown' });
  assert.equal((await service.reconcileAuthenticatedPrepaidRenewalPix(input)).state, 'awaiting_payment');
  assert(calls.includes('reconcileUnknownSellerPrepaidRenewalPixPayment'));
  assert(!calls.includes('executeAuthenticatedLockedIsolatedPrepaidRenewalPix'));
});
test('incomplete unknown search remains recoverable without a new charge', async () => {
  docs.set(attemptPath, { executionState: 'outcome_unknown' }); searchFailure = new Error('RENEWAL_PIX_RECONCILIATION_SEARCH_INCOMPLETE');
  const result = await service.reconcileAuthenticatedPrepaidRenewalPix(input);
  assert.equal(result.state, 'recovery_required'); assert(!calls.includes('executeAuthenticatedLockedIsolatedPrepaidRenewalPix'));
});
test('transport timeout produces recovery state without a second executor call or leaking error text', async () => {
  process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED = 'true'; executionFailure = new Error('private provider failure');
  const result = await service.checkoutAuthenticatedPrepaidRenewalPix(input);
  assert.equal(result.state, 'recovery_required'); assert.equal(result.code, 'RENEWAL_PIX_PROVIDER_LOOKUP_UNAVAILABLE');
  assert.equal(calls.filter(x => x === 'executeAuthenticatedLockedIsolatedPrepaidRenewalPix').length, 1);
});
test('approved/accredited payment activates the contract and repeated status is provider-free', async () => {
  docs.set(attemptPath, { providerPaymentId: '123' }); payment.status = 'approved'; payment.status_detail = 'accredited';
  assert.equal((await service.reconcileAuthenticatedPrepaidRenewalPix(input)).state, 'activated'); calls.length = 0;
  assert.equal((await service.reconcileAuthenticatedPrepaidRenewalPix(input)).state, 'activated');
  assert(!calls.includes('mercadoPagoStoreRequest')); assert(!calls.includes('recordPrepaidRenewalWithVerifiedSources'));
});
test('confirmed payment with activation failure offers recovery, never payable instructions', async () => {
  docs.set(attemptPath, { providerPaymentId: '123' }); payment.status = 'approved'; payment.status_detail = 'accredited'; activationFailure = new Error('transaction unavailable');
  const result = await service.reconcileAuthenticatedPrepaidRenewalPix(input);
  assert.equal(result.state, 'payment_confirmed'); assert.equal(result.pix, undefined);
});
test('another buyer is rejected before provider lookup', async () => {
  authBuyer = 'other'; await assert.rejects(service.reconcileAuthenticatedPrepaidRenewalPix(input), /ACCEPTANCE_REQUIRED/);
  assert(!calls.includes('mercadoPagoStoreRequest'));
});
test('mismatched recipient returns no Pix instructions or activation', async () => {
  docs.set(attemptPath, { providerPaymentId: '123' }); payment.collector_id = 9;
  const result = await service.reconcileAuthenticatedPrepaidRenewalPix(input);
  assert.equal(result.state, 'recovery_required'); assert.equal(result.pix, undefined); assert(!calls.includes('recordPrepaidRenewalWithVerifiedSources'));
});
