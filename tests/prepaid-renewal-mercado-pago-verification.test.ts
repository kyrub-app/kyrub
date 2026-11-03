import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const calls: Array<{ name: string; args: unknown[] }> = [];
let providerPayment: Record<string, unknown> = {};
let sellerAccountId = '12345';

const bundled = await build({
  entryPoints: ['server/payments/prepaidRenewalPaymentVerification.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'mock-mercado-pago-oauth',
    setup(plugin) {
      plugin.onResolve({ filter: /mercadoPagoStoreOauthService\.js$/ }, () => ({
        path: 'oauth', namespace: 'test-oauth',
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'test-oauth' }, () => ({
        contents: `
          export const getValidMercadoPagoStoreAccessToken = async (...args) =>
            globalThis.__renewalProviderMock('token', args);
          export const mercadoPagoStoreRequest = async (...args) =>
            globalThis.__renewalProviderMock('payment', args);
        `,
        loader: 'js',
      }));
    },
  }],
});
const { verifyPrepaidRenewalMercadoPagoPayment } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
(globalThis as typeof globalThis & {
  __renewalProviderMock?: (name: string, args: unknown[]) => unknown;
}).__renewalProviderMock = (name, args) => {
  calls.push({ name, args });
  return name === 'token' ? { externalAccountId: sellerAccountId } : providerPayment;
};

const request = {
  sellerCredentialScopeId: 'store-a',
  paymentId: '987654',
  expectedExternalReference: 'kyrub:prepaid-renewal:store-a:' + 'a'.repeat(64),
  expectedAmountMinor: 29990,
};
const approved = () => ({
  id: 987654, status: 'approved', status_detail: 'accredited',
  collector_id: 12345, transaction_amount: 299.9,
  date_approved: '2026-11-01T12:00:00.000Z', currency_id: 'BRL',
  external_reference: request.expectedExternalReference,
});
const reset = () => {
  calls.length = 0;
  sellerAccountId = '12345';
  providerPayment = approved();
};

test('Mercado Pago verification uses seller OAuth scope and exact payment id', async () => {
  reset();
  const payment = await verifyPrepaidRenewalMercadoPagoPayment(request);
  assert.equal(payment.verifiedByProvider, true);
  assert.equal(payment.amountMinor, 29990);
  assert.equal(payment.status, 'approved');
  assert.deepEqual(calls, [
    { name: 'token', args: ['store-a'] },
    { name: 'payment', args: ['store-a', '/v1/payments/987654'] },
  ]);
});

test('Mercado Pago verification rejects invalid payment identifiers before provider calls', async () => {
  reset();
  await assert.rejects(
    verifyPrepaidRenewalMercadoPagoPayment({ ...request, paymentId: '../987654' }),
    /INVALID_RENEWAL_PAYMENT_LOOKUP/,
  );
  assert.equal(calls.length, 0);
});

test('Mercado Pago verification rejects unknown seller account before payment lookup', async () => {
  reset();
  sellerAccountId = '';
  await assert.rejects(verifyPrepaidRenewalMercadoPagoPayment(request), /RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED/);
  assert.deepEqual(calls.map(call => call.name), ['token']);
});

test('Mercado Pago verification rejects mismatched collector, amount, reference, currency and status', async () => {
  const mismatches: Array<Record<string, unknown>> = [
    { collector_id: 22222 },
    { transaction_amount: 299.91 },
    { external_reference: 'other-reference' },
    { currency_id: 'USD' },
    { status: 'pending' },
    { status_detail: 'pending_contingency' },
    { id: 123 },
    { date_approved: 'invalid' },
  ];
  for (const change of mismatches) {
    reset();
    providerPayment = { ...approved(), ...change };
    await assert.rejects(
      verifyPrepaidRenewalMercadoPagoPayment(request),
      /RENEWAL_PROVIDER_PAYMENT_MISMATCH/,
      JSON.stringify(change),
    );
    assert.deepEqual(calls.map(call => call.name), ['token', 'payment']);
  }
});
