import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getPaymentProviderAdapter,
} from '../server/payments/paymentProviderAdapter';
import {
  DEFAULT_PAYMENT_PROVIDER_POLICY,
  assertPaymentProviderBinding,
  normalizePaymentProviderPolicy,
  resolvePrimaryPaymentProvider,
  type PaymentProviderPolicy,
} from '../server/payments/paymentProviderPolicy';
import {
  calculatePlatformFeeSnapshot,
  type PlatformFeePolicy,
} from '../shared/platformFeePolicy';

const adapterSource = readFileSync(
  'server/payments/paymentProviderAdapter.ts',
  'utf8'
);
const policySource = readFileSync(
  'server/payments/paymentProviderPolicy.ts',
  'utf8'
);
const localPixServiceSource = readFileSync(
  'server/attendance/localMercadoPagoPixService.ts',
  'utf8'
);
const feePolicySource = readFileSync(
  'shared/platformFeePolicy.ts',
  'utf8'
);

test('Mercado Pago remains the only real adapter and default provider while unsupported providers fail closed', () => {
  assert.equal(getPaymentProviderAdapter('mercado-pago').id, 'mercado-pago');
  assert.equal(DEFAULT_PAYMENT_PROVIDER_POLICY.primaryProvider, 'mercado-pago');
  assert.equal(resolvePrimaryPaymentProvider().id, 'mercado-pago');
  assert.throws(
    () => getPaymentProviderAdapter('unsupported-provider'),
    /PAYMENT_PROVIDER_UNSUPPORTED/
  );

  const unsupportedFallback = {
    primaryProvider: 'mercado-pago',
    fallbackProvider: 'future-provider',
  } as unknown as PaymentProviderPolicy;
  assert.throws(
    () => normalizePaymentProviderPolicy(unsupportedFallback),
    /PAYMENT_PROVIDER_FALLBACK_UNSUPPORTED/
  );
  assert.throws(
    () => normalizePaymentProviderPolicy({
      primaryProvider: 'mercado-pago',
      fallbackProvider: 'mercado-pago',
    }),
    /PAYMENT_PROVIDER_FALLBACK_DUPLICATES_PRIMARY/
  );
});

test('provider binding cannot silently switch after a charge is created', () => {
  assert.doesNotThrow(() => assertPaymentProviderBinding({
    selectedProvider: 'mercado-pago',
    boundProvider: 'mercado-pago',
    providerPaymentId: 'mp-123',
  }));
  assert.throws(() => assertPaymentProviderBinding({
    selectedProvider: 'mercado-pago',
    boundProvider: 'future-provider',
    providerPaymentId: 'future-123',
  }), /PAYMENT_PROVIDER_SWITCH_AFTER_CHARGE_FORBIDDEN/);
  assert.throws(() => assertPaymentProviderBinding({
    selectedProvider: 'mercado-pago',
    boundProvider: 'future-provider',
  }), /PAYMENT_PROVIDER_BINDING_CONFLICT/);
});

test('platform fee policy calculates buyer and merchant fees without mixing provider cost', () => {
  const policy: PlatformFeePolicy = {
    id: 'example-policy',
    version: 1,
    effectiveFrom: '2026-09-18T00:00:00.000Z',
    buyerFee: { type: 'fixed', amount: 0.99 },
    merchantSaleFee: { type: 'percentage', ratePercent: 3 },
  };
  const snapshot = calculatePlatformFeeSnapshot({ saleAmount: 100, policy });
  assert.equal(snapshot.buyerFeeAmount, 0.99);
  assert.equal(snapshot.merchantSaleFeeAmount, 3);
  assert.equal(snapshot.grossPlatformFeeAmount, 3.99);
  assert.equal('providerCost' in snapshot, false);
  assert.match(feePolicySource, /InternalProviderCostObservation/);
  assert.match(feePolicySource, /Provider cost is intentionally absent from the public fee snapshot/);
});

test('fee policy is model-only in this cut and does not change the live local Pix amount', () => {
  assert.doesNotMatch(localPixServiceSource, /calculatePlatformFeeSnapshot|buyerFeeAmount|merchantSaleFeeAmount|grossPlatformFeeAmount/);
  assert.match(localPixServiceSource, /amount: validated\.intent\.amount/);
  assert.match(localPixServiceSource, /resolvePrimaryPaymentProvider/);
  assert.match(localPixServiceSource, /provider\.createLocalPixPayment/);
  assert.match(localPixServiceSource, /provider\.getPixCheckout/);
});

test('provider-neutral layer keeps Mercado Pago behind an adapter instead of widening payment authority', () => {
  assert.match(adapterSource, /interface PaymentProviderAdapter/);
  assert.match(adapterSource, /createLocalPixPayment/);
  assert.match(adapterSource, /getPixCheckout/);
  assert.match(policySource, /Once a provider has created a charge/);
  assert.match(localPixServiceSource, /attachPixProviderToLocalIntent/);
  assert.match(localPixServiceSource, /attachMercadoPagoPixToLocalIntent = attachPixProviderToLocalIntent/);
  assert.doesNotMatch(localPixServiceSource, /paidQuantity\s*:/);
  assert.doesNotMatch(localPixServiceSource, /paymentStatus\s*:/);
  assert.doesNotMatch(localPixServiceSource, /fiscal|points|settlement/i);
});
