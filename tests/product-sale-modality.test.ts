import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSubscriptionSaleModality,
  isSubscriptionSaleModality,
  ONE_TIME_PRODUCT_SALE_MODALITY,
  parseProductSaleModality,
} from '../shared/productSaleModality';

test('legacy products remain one-time purchases without invented subscription data', () => {
  assert.deepEqual(parseProductSaleModality(undefined), ONE_TIME_PRODUCT_SALE_MODALITY);
  assert.deepEqual(parseProductSaleModality(null), ONE_TIME_PRODUCT_SALE_MODALITY);
});

test('builds a monthly service-credit subscription independently from payment provider', () => {
  const modality = buildSubscriptionSaleModality({
    billingUnit: 'month',
    benefitKind: 'usage_credits',
    unitsPerCycle: 2,
  });

  assert.equal(modality.mode, 'subscription');
  assert.equal(modality.subscription?.billingInterval.unit, 'month');
  assert.equal(modality.subscription?.billingInterval.count, 1);
  assert.equal(modality.subscription?.benefit.kind, 'usage_credits');
  assert.equal(modality.subscription?.benefit.unitsPerCycle, 2);
  assert.equal(modality.subscription?.autoRenew, true);
  assert.equal('provider' in modality, false);
  assert.equal('merchantAccountId' in modality, false);
  assert.equal('platformAccountId' in modality, false);
});

test('supports access subscriptions without fictitious usage quantity', () => {
  const modality = buildSubscriptionSaleModality({
    billingUnit: 'month',
    benefitKind: 'access',
  });

  assert.equal(modality.subscription?.benefit.unitsPerCycle, null);
  assert.equal(isSubscriptionSaleModality(modality), true);
});

test('supports recurring physical deliveries with explicit units per cycle', () => {
  const modality = buildSubscriptionSaleModality({
    billingUnit: 'week',
    billingIntervalCount: 2,
    benefitKind: 'recurring_delivery',
    unitsPerCycle: 5,
  });

  assert.deepEqual(parseProductSaleModality(modality), modality);
});

test('rejects malformed recurring terms instead of silently downgrading to one-time', () => {
  assert.equal(
    parseProductSaleModality({
      schemaVersion: 1,
      mode: 'subscription',
      subscription: {
        schemaVersion: 1,
        billingInterval: { unit: 'month', count: 0 },
        benefit: { kind: 'usage_credits', unitsPerCycle: 2 },
        autoRenew: true,
      },
    }),
    null
  );

  assert.equal(
    parseProductSaleModality({
      schemaVersion: 1,
      mode: 'subscription',
      subscription: {
        schemaVersion: 1,
        billingInterval: { unit: 'month', count: 1 },
        benefit: { kind: 'usage_credits', unitsPerCycle: null },
        autoRenew: true,
      },
    }),
    null
  );
});

test('does not allow one-time products to carry hidden subscription terms', () => {
  assert.equal(
    parseProductSaleModality({
      schemaVersion: 1,
      mode: 'one_time',
      subscription: {
        schemaVersion: 1,
        billingInterval: { unit: 'month', count: 1 },
        benefit: { kind: 'access', unitsPerCycle: null },
        autoRenew: true,
      },
    }),
    null
  );
});
