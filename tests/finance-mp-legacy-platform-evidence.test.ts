import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertLegacyPlatformMercadoPagoPaymentScope,
  type LegacyPlatformPaymentScope,
} from '../shared/mercadoPagoLegacyPlatformPaymentScope';

const valid = (): LegacyPlatformPaymentScope => ({
  storeId: 'owner-a',
  paymentId: 'pay-123',
  providerPaymentId: '179700976673',
  canonicalPaymentIntentId: 'intent-567',
  providerId: 179700976673,
  externalReference: 'intent-567',
  metadata: {
    kyrub_store_id: 'owner-a',
    kyrub_payment_id: 'pay-123',
    kyrub_payment_intent_id: 'intent-567',
  },
  collectorId: 987654,
  platformAccountId: '987654',
});

test('legacy platform MP evidence is accepted only with all four identity proofs', () => {
  assert.doesNotThrow(() => assertLegacyPlatformMercadoPagoPaymentScope(valid()));
  // Legacy canonical payments can lack paymentIntentId; the external reference
  // and provider metadata must still agree in that case.
  assert.doesNotThrow(() => assertLegacyPlatformMercadoPagoPaymentScope({
    ...valid(), canonicalPaymentIntentId: '',
  }));
});

test('fail closed for another store, payment, intent, provider ID, collector or absent metadata', () => {
  const cases: Partial<LegacyPlatformPaymentScope>[] = [
    { storeId: 'owner-b' },
    { paymentId: 'pay-other' },
    { providerPaymentId: 'different' },
    { providerId: 'different' },
    { canonicalPaymentIntentId: 'different-intent' },
    { externalReference: 'different-intent' },
    { externalReference: '' },
    { collectorId: 'another-collector' },
    { collectorId: '' },
    { platformAccountId: '' },
    { metadata: null },
    { metadata: {} },
    { metadata: { kyrub_store_id: 'owner-b', kyrub_payment_id: 'pay-123', kyrub_payment_intent_id: 'intent-567' } },
    { metadata: { kyrub_store_id: 'owner-a', kyrub_payment_id: 'pay-other', kyrub_payment_intent_id: 'intent-567' } },
    { metadata: { kyrub_store_id: 'owner-a', kyrub_payment_id: 'pay-123', kyrub_payment_intent_id: 'other-intent' } },
  ];
  for (const patch of cases) {
    assert.throws(
      () => assertLegacyPlatformMercadoPagoPaymentScope({ ...valid(), ...patch }),
      /STORE_PROVIDER_RECONCILIATION_LEGACY_SCOPE_UNVERIFIED/,
      JSON.stringify(patch)
    );
  }
});

test('legacy central MP read is restricted to unbound paid captures when merchant OAuth is absent', () => {
  const r = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
  const reconciliation = r.split('const reconcileMercadoPagoPayment = async')[1]?.split('const loadReconciliation = async')[0] ?? '';
  const merchantBranch = reconciliation.split('if (binding) {')[1]?.split('} else {')[0] ?? '';
  const legacyBranch = reconciliation.split('} else {')[1] ?? '';
  assert.match(merchantBranch, /getValidMercadoPagoStoreAccessToken\(binding\.legacyStoreId\)/);
  assert.doesNotMatch(merchantBranch, /getMercadoPagoPayment|platformAccountId/);
  assert.match(legacyBranch, /legacyStoreIdForCanonicalStore\(storeId\)/);
  assert.match(legacyBranch, /error\.message === 'MERCADO_PAGO_STORE_NOT_CONNECTED'/);
  assert.match(legacyBranch, /getMercadoPagoPayment\(payment\.providerPaymentId\)/);
  assert.match(legacyBranch, /getMercadoPagoPlatformAccountId\(\)/);
  assert.match(legacyBranch, /assertLegacyPlatformMercadoPagoPaymentScope\(/);
  assert.match(legacyBranch, /canonicalPaymentIntentId: payment\.paymentIntentId/);
  assert.match(legacyBranch, /collectorId: providerPayment\.collector_id/);
  assert.match(reconciliation, /return saveReconciliation\(reconciliation\)/);
});

test('historical legacy credential read is authenticated, account bound, and cannot manufacture amounts', () => {
  const r = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
  const provider = readFileSync('server/payments/mercadoPagoPixProvider.ts', 'utf8');
  assert.match(r, /await requireOwner\(clean\(request\.headers\.authorization\), storeId\)/);
  assert.match(r, /const payment = await loadCanonicalPayment\(storeId, paymentId\)/);
  assert.match(r, /STORE_PROVIDER_RECONCILIATION_LEGACY_SCOPE_UNVERIFIED/);
  assert.match(provider, /getMercadoPagoPlatformAccountId/);
  assert.match(provider, /mercadoPagoRequest<\{ id\?: unknown \}>\('\/users\/me'\)/);
  assert.match(r, /providerPaymentId !== input\.payment\.providerPaymentId/);
  assert.match(r, /const feeState = feeEvidence\(input\.providerPayment\)/);
  assert.match(r, /netReceivedMinor: toMinor\(input\.providerPayment\.transaction_details\?\.net_received_amount\)/);
  assert.doesNotMatch(r, /transaction\.update\([^)]*paymentRef/);
});

test('legacy without verifiable provenance returns diagnostic, never silently claiming reconciliation', () => {
  const r = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
  assert.match(r, /sem comprovação suficiente de loja, intenção e conta recebedora/);
  assert.match(r, /credencial que processou o Pix histórico não está disponível/);
});
