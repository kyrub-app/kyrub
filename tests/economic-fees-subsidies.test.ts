import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildEconomicAllocationSnapshot,
  buildMarketplaceEconomicAllocationSnapshot,
} from '../shared/economicFeesSubsidies';

describe('economic fees and subsidies', () => {
  test('marketplace snapshot reconciles customer payment, store subsidy and delivery', () => {
    const snapshot = buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 100,
      discountTotal: 15,
      deliveryFee: 8,
      total: 93,
    });

    assert.equal(snapshot.merchandiseGrossMinor, 10000);
    assert.equal(snapshot.customerPaidMinor, 9300);
    assert.equal(snapshot.storeSubsidyMinor, 1500);
    assert.equal(snapshot.deliveryFeeMinor, 800);
    assert.equal(snapshot.courierRemunerationMinor, 800);
    assert.equal(snapshot.kyrubIncentiveMinor, 0);
    assert.equal(snapshot.partnerSubsidyMinor, 0);
  });

  test('delivery fee is always fully destined to courier remuneration', () => {
    const snapshot = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 5000,
      customerPaidMinor: 6200,
      deliveryFeeMinor: 1200,
    });

    assert.equal(snapshot.deliveryFeeMinor, 1200);
    assert.equal(snapshot.courierRemunerationMinor, 1200);
  });

  test('store, Kyrub and partner subsidies remain separate burden sources', () => {
    const snapshot = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 10000,
      customerPaidMinor: 8800,
      deliveryFeeMinor: 800,
      storeSubsidyMinor: 1000,
      kyrubIncentiveMinor: 500,
      partnerSubsidyMinor: 500,
    });

    assert.equal(snapshot.storeSubsidyMinor, 1000);
    assert.equal(snapshot.kyrubIncentiveMinor, 500);
    assert.equal(snapshot.partnerSubsidyMinor, 500);
    assert.equal(snapshot.burden.customerMinor, 8800);
    assert.equal(snapshot.burden.storeMinor, 1000);
    assert.equal(snapshot.burden.kyrubMinor, 500);
    assert.equal(snapshot.burden.partnerMinor, 500);
  });

  test('observed real costs identify who bears the cost without inventing percentages', () => {
    const snapshot = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 10000,
      customerPaidMinor: 10000,
      deliveryFeeMinor: 0,
      observedCosts: [
        {
          id: 'provider-cost:pay-1',
          kind: 'provider_processing',
          amountMinor: 137,
          borneBy: 'kyrub',
          beneficiary: 'payment-provider',
          source: 'provider-settlement',
        },
      ],
    });

    assert.equal(snapshot.observedCostsMinor, 137);
    assert.equal(snapshot.burden.kyrubMinor, 137);
    assert.equal(snapshot.observedCosts[0].amountMinor, 137);
  });

  test('rejects funding equations that do not reconcile exactly in minor units', () => {
    assert.throws(
      () =>
        buildEconomicAllocationSnapshot({
          merchandiseGrossMinor: 10000,
          customerPaidMinor: 9001,
          deliveryFeeMinor: 0,
          storeSubsidyMinor: 1000,
        }),
      /FUNDING_MISMATCH/
    );
  });

  test('rejects negative values and unsafe integer arithmetic', () => {
    assert.throws(() =>
      buildEconomicAllocationSnapshot({
        merchandiseGrossMinor: -1,
        customerPaidMinor: 0,
        deliveryFeeMinor: 0,
      })
    );
    assert.throws(() =>
      buildEconomicAllocationSnapshot({
        merchandiseGrossMinor: Number.MAX_SAFE_INTEGER,
        customerPaidMinor: Number.MAX_SAFE_INTEGER,
        deliveryFeeMinor: 0,
        observedCosts: [
          {
            id: 'overflow',
            kind: 'other',
            amountMinor: 1,
            borneBy: 'customer',
            beneficiary: 'partner',
            source: 'observed',
          },
        ],
      })
    );
  });
});
