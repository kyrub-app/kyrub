import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  nextStorePurchasePayableKey,
  storePurchasePayableKeyLabel,
  summarizeStorePurchasePayables,
} from '../shared/storePurchasePayableSchedule.js';

describe('purchase payable schedule helpers', () => {
  test('first obligation remains primary and following obligations are sequential', () => {
    assert.equal(nextStorePurchasePayableKey([]), 'primary');
    assert.equal(nextStorePurchasePayableKey(['primary']), 'installment_002');
    assert.equal(
      nextStorePurchasePayableKey(['primary', 'installment_002']),
      'installment_003'
    );
    assert.equal(
      nextStorePurchasePayableKey(['primary', 'installment_004', 'installment_002']),
      'installment_005'
    );
  });

  test('human labels preserve primary as parcel one', () => {
    assert.equal(storePurchasePayableKeyLabel('primary'), 'Parcela 1');
    assert.equal(storePurchasePayableKeyLabel('installment_002'), 'Parcela 2');
    assert.equal(storePurchasePayableKeyLabel('installment_015'), 'Parcela 15');
  });

  test('active commitment excludes cancelled obligations', () => {
    const summary = summarizeStorePurchasePayables([
      { purchasePayableKey: 'primary', amountMinor: 100000, status: 'paid' },
      { purchasePayableKey: 'installment_002', amountMinor: 100000, status: 'open' },
      { purchasePayableKey: 'installment_003', amountMinor: 100000, status: 'cancelled' },
    ], 300000);

    assert.equal(summary.registeredMinor, 300000);
    assert.equal(summary.activeMinor, 200000);
    assert.equal(summary.paidMinor, 100000);
    assert.equal(summary.openMinor, 100000);
    assert.equal(summary.cancelledMinor, 100000);
    assert.equal(summary.differenceMinor, 100000);
  });

  test('difference may be negative and is not used as a blocking policy', () => {
    const summary = summarizeStorePurchasePayables([
      { purchasePayableKey: 'primary', amountMinor: 180000, status: 'open' },
      { purchasePayableKey: 'installment_002', amountMinor: 140000, status: 'open' },
    ], 300000);

    assert.equal(summary.activeMinor, 320000);
    assert.equal(summary.differenceMinor, -20000);
  });

  test('unknown purchase total keeps difference unavailable', () => {
    const summary = summarizeStorePurchasePayables([
      { purchasePayableKey: 'primary', amountMinor: 100000, status: 'open' },
    ], null);

    assert.equal(summary.activeMinor, 100000);
    assert.equal(summary.differenceMinor, null);
  });
});
