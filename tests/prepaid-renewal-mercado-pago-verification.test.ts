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

test('prepaid renewal Pix payload uses accepted proposal reference and rejects tampering', async () => {
  const { buildPrepaidRenewalPixRequest } = await import('../server/payments/prepaidRenewalPixRequest.js');
  const proposalId = 'a'.repeat(64);
  const input = {
    storeId: 'store-a', proposalId,
    acceptedBuyerId: 'buyer-a', authenticatedBuyerId: 'buyer-a',
    acceptedTotalMinor: 29990, proposalTotalMinor: 29990,
    sellerCredentialScopeId: 'store-a',
    paymentExternalReference: `kyrub:prepaid-renewal:store-a:${proposalId}`,
    payerEmail: 'buyer@example.com',
    expiresAt: '2099-11-03T12:00:00.000Z',
  };
  const payload = buildPrepaidRenewalPixRequest(input);
  const body = JSON.parse(payload.init.body);
  assert.equal(body.external_reference, input.paymentExternalReference);
  assert.equal(body.transaction_amount, 299.9);
  assert.equal(payload.init.headers['X-Idempotency-Key'], `prepaid-renewal-${proposalId}`);
  for (const change of [
    { authenticatedBuyerId: 'other' }, { sellerCredentialScopeId: 'other' },
    { proposalTotalMinor: 1 }, { paymentExternalReference: 'other' },
  ]) {
    assert.throws(() => buildPrepaidRenewalPixRequest({ ...input, ...change }),
      /INVALID_PREPAID_RENEWAL_PIX_BINDING/);
  }
});

test('renewal merchant authority distinguishes canonical store from legacy OAuth owner scope', async () => {
  const { resolvePrepaidRenewalRecipientBinding } = await import('../server/payments/prepaidRenewalRecipientBinding.js');
  const authority = {
    schemaVersion: 1 as const, context: 'store_subscription' as const,
    recipientKind: 'merchant_store' as const, beneficiaryPrincipalId: 'store:store-a',
    provider: 'mercado_pago' as const, credentialAuthority: 'store_oauth_vault' as const,
    credentialScopeId: 'owner-a', canonicalStoreId: 'store-a',
    ownerUserId: 'owner-a', externalAccountId: '12345',
    platformFeeMode: 'separate' as const,
  };
  assert.deepEqual(resolvePrepaidRenewalRecipientBinding({
    storeId: 'store-a', storedSellerCredentialScopeId: 'store-a', authority,
  }), { credentialScopeId: 'owner-a', externalAccountId: '12345' });
  assert.deepEqual(resolvePrepaidRenewalRecipientBinding({
    storeId: 'store-a', storedSellerCredentialScopeId: 'owner-a', authority,
  }), { credentialScopeId: 'owner-a', externalAccountId: '12345' });
  for (const change of [
    { canonicalStoreId: 'other-store' },
    { credentialScopeId: 'other-owner' },
    { externalAccountId: '' },
    { context: 'platform_plan_subscription' as const },
  ]) {
    assert.throws(() => resolvePrepaidRenewalRecipientBinding({
      storeId: 'store-a', storedSellerCredentialScopeId: 'store-a',
      authority: { ...authority, ...change },
    }), /RENEWAL_RECIPIENT_AUTHORITY_MISMATCH/);
  }
  assert.throws(() => resolvePrepaidRenewalRecipientBinding({
    storeId: 'store-a', storedSellerCredentialScopeId: 'attacker-owner', authority,
  }), /RENEWAL_RECIPIENT_AUTHORITY_MISMATCH/);
});
