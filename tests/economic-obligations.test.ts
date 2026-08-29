import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildEconomicAllocationSnapshot,
  buildMarketplaceEconomicAllocationSnapshot,
  type EconomicAllocationSnapshot,
} from '../shared/economicFeesSubsidies';
import {
  buildCourierPayableObligationFromCapture,
  buildCourierPayableObligationId,
  buildStoreReceivableObligationFromCapture,
  buildStoreReceivableObligationId,
  canTransitionEconomicObligationStatus,
  deriveStoreReceivableMinor,
  economicObligationPath,
} from '../shared/economicObligations';
import type { StoreEconomicLedgerEntry } from '../shared/storeEconomicLedger';

const capture = (
  allocation: EconomicAllocationSnapshot,
  overrides: Partial<StoreEconomicLedgerEntry> = {}
): StoreEconomicLedgerEntry => ({
  schemaVersion: 1,
  id: 'payment:capture:pay-1',
  storeId: 'store-1',
  kind: 'payment_capture',
  currency: 'BRL',
  amountMinor: allocation.customerPaidMinor,
  paymentId: 'pay-1',
  paymentIntentId: 'intent-1',
  orderId: 'order-1',
  buyerId: 'buyer-1',
  paymentContext: 'marketplace',
  paymentMethod: 'pix',
  provider: 'mercado_pago',
  providerPaymentId: 'provider-pay-1',
  providerEventId: 'event-paid-1',
  sourceAuthority: 'provider_webhook',
  reversalOfEntryId: '',
  occurredAt: '2026-08-29T10:01:00.000Z',
  economicAllocation: allocation,
  ...overrides,
});

describe('economic obligations foundation', () => {
  test('store receivable is merchandise after store-funded discount, never delivery revenue', () => {
    const allocation = buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 30,
      discountTotal: 5,
      deliveryFee: 4.5,
      total: 29.5,
    });
    const obligation = buildStoreReceivableObligationFromCapture(capture(allocation));

    assert.ok(obligation);
    assert.equal(deriveStoreReceivableMinor(allocation), 2500);
    assert.equal(obligation.amountMinor, 2500);
    assert.equal(obligation.kind, 'store_receivable');
    assert.equal(obligation.status, 'pending');
    assert.equal(obligation.beneficiaryPrincipalId, 'store:store-1');
    assert.equal(obligation.funding.customerMinor, 2500);
    assert.equal(obligation.funding.storeFundedDiscountMinor, 500);
    assert.equal(obligation.fulfillmentId, '');
  });

  test('Kyrub and partner incentives fund store receivable without becoming platform revenue', () => {
    const allocation = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 10000,
      customerPaidMinor: 9750,
      deliveryFeeMinor: 1500,
      storeSubsidyMinor: 1000,
      kyrubIncentiveMinor: 500,
      partnerSubsidyMinor: 250,
      observedCosts: [
        {
          id: 'provider-cost-1',
          kind: 'provider_processing',
          amountMinor: 300,
          borneBy: 'store',
          beneficiary: 'payment-provider',
          source: 'provider-statement',
        },
      ],
    });
    const obligation = buildStoreReceivableObligationFromCapture(capture(allocation));

    assert.ok(obligation);
    assert.equal(obligation.amountMinor, 9000);
    assert.deepEqual(obligation.funding, {
      customerMinor: 8250,
      kyrubMinor: 500,
      partnerMinor: 250,
      storeFundedDiscountMinor: 1000,
    });
    assert.equal(allocation.observedCostsMinor, 300);
    assert.equal(obligation.amountMinor, 9000, 'observed provider cost must remain a separate fact');
  });

  test('courier payable preserves 100% of delivery fee and requires a known courier plus fulfillment', () => {
    const allocation = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 10000,
      customerPaidMinor: 11500,
      deliveryFeeMinor: 1500,
    });
    const paid = capture(allocation, { amountMinor: 11500 });
    const obligation = buildCourierPayableObligationFromCapture({
      capture: paid,
      fulfillmentId: 'fulfillment-1',
      courierUserId: 'courier-user-1',
    });

    assert.ok(obligation);
    assert.equal(obligation.amountMinor, 1500);
    assert.equal(obligation.kind, 'courier_payable');
    assert.equal(obligation.beneficiaryType, 'courier');
    assert.equal(obligation.beneficiaryPrincipalId, 'courier-user-1');
    assert.equal(obligation.fulfillmentId, 'fulfillment-1');
    assert.equal(obligation.funding.customerMinor, 1500);
    assert.throws(() => buildCourierPayableObligationFromCapture({
      capture: paid,
      fulfillmentId: '',
      courierUserId: 'courier-user-1',
    }));
    assert.throws(() => buildCourierPayableObligationFromCapture({
      capture: paid,
      fulfillmentId: 'fulfillment-1',
      courierUserId: '',
    }));
  });

  test('zero delivery fee creates no courier payable instead of inventing remuneration', () => {
    const allocation = buildEconomicAllocationSnapshot({
      merchandiseGrossMinor: 3000,
      customerPaidMinor: 3000,
      deliveryFeeMinor: 0,
    });
    assert.equal(buildCourierPayableObligationFromCapture({
      capture: capture(allocation, { amountMinor: 3000 }),
      fulfillmentId: 'fulfillment-1',
      courierUserId: 'courier-user-1',
    }), null);
  });

  test('obligation ids are deterministic and paths stay tenant scoped', () => {
    const storeId = buildStoreReceivableObligationId('pay-1');
    const courierId = buildCourierPayableObligationId({
      paymentId: 'pay-1',
      fulfillmentId: 'fulfillment-1',
      courierUserId: 'courier-user-1',
    });
    assert.equal(storeId, 'obligation:store_receivable:pay-1');
    assert.equal(
      courierId,
      'obligation:courier_payable:pay-1:fulfillment-1:courier-user-1'
    );
    assert.equal(
      economicObligationPath('store-1', storeId),
      'stores/store-1/economicObligations/obligation%3Astore_receivable%3Apay-1'
    );
  });

  test('obligation lifecycle separates recognition, eligibility, settlement and pre-settlement reversal', () => {
    assert.equal(canTransitionEconomicObligationStatus('pending', 'eligible'), true);
    assert.equal(canTransitionEconomicObligationStatus('pending', 'reversed'), true);
    assert.equal(canTransitionEconomicObligationStatus('eligible', 'settled'), true);
    assert.equal(canTransitionEconomicObligationStatus('eligible', 'reversed'), true);
    assert.equal(canTransitionEconomicObligationStatus('settled', 'reversed'), false);
    assert.equal(canTransitionEconomicObligationStatus('reversed', 'eligible'), false);
    assert.equal(canTransitionEconomicObligationStatus('settled', 'settled'), true);
  });

  test('obligation source must match the immutable captured economic allocation', () => {
    const allocation = buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 30,
      discountTotal: 5,
      deliveryFee: 4.5,
      total: 29.5,
    });
    assert.throws(() => buildStoreReceivableObligationFromCapture(
      capture(allocation, { amountMinor: 3000 })
    ));
    assert.throws(() => buildStoreReceivableObligationFromCapture(
      capture(allocation, { economicAllocation: undefined })
    ));
  });

  test('foundation does not create custody, wallet, PSP split or transfer behavior', () => {
    const source = readFileSync('shared/economicObligations.ts', 'utf8');
    assert.doesNotMatch(
      source,
      /walletBalance|custodialBalance|application_fee_amount|splitRecipient|transferInstruction/i
    );
    assert.doesNotMatch(source, /firebase|firestore|fetch\(|axios/i);
    assert.match(source, /store_receivable/);
    assert.match(source, /courier_payable/);
  });
});

describe('economic obligations persistence', () => {
  test('persistence is forward-only from a new pending-to-paid capture', () => {
    const service = readFileSync('server/payments/economicObligationsService.ts', 'utf8');
    assert.match(service, /input\.duplicate/);
    assert.match(service, /input\.eventType !== 'payment\.paid'/);
    assert.match(service, /input\.previousPaymentStatus !== 'pending'/);
    assert.match(service, /input\.economicLedgerPlan\.writes/);
    assert.match(service, /entry\.kind === 'payment_capture'/);
    assert.doesNotMatch(service, /buildRecoveredPaymentCaptureEconomicEntry/);
  });

  test('new capture persists only store receivable and never infers courier from payment', () => {
    const service = readFileSync('server/payments/economicObligationsService.ts', 'utf8');
    assert.match(service, /buildStoreReceivableObligationFromCapture/);
    assert.match(service, /economicObligationPath/);
    assert.doesNotMatch(service, /buildCourierPayableObligationFromCapture/);
    assert.doesNotMatch(service, /courierUserId|assignedCourier|acceptedBy/);
  });

  test('missing economic allocation does not create an inferred receivable', () => {
    const service = readFileSync('server/payments/economicObligationsService.ts', 'utf8');
    assert.match(service, /if \(!capture\.economicAllocation\)/);
    assert.match(service, /return null;/);
  });

  test('deterministic document is read before writes and an equivalent existing obligation is idempotent', () => {
    const service = readFileSync('server/payments/economicObligationsService.ts', 'utf8');
    const getAt = service.indexOf('input.transaction.get(ref)');
    const setAt = service.indexOf('transaction.set(write.ref, write.obligation)');
    assert.ok(getAt >= 0);
    assert.ok(setAt > getAt);
    assert.match(service, /if \(snapshot\.exists\)/);
    assert.match(service, /assertObligationEquivalent/);
    assert.match(service, /return \{ writes: \[\] \};/);
    assert.match(service, /ECONOMIC_OBLIGATION_CONFLICT:/);
  });

  test('webhook prepares obligation reads before first write and applies them in the same transaction', () => {
    const processor = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');
    const prepareAt = processor.indexOf('prepareEconomicObligationsPaymentPlan');
    const firstWriteAt = processor.indexOf('transaction.update(intentRef');
    const applyAt = processor.indexOf('applyEconomicObligationsPaymentPlan(transaction');
    assert.ok(prepareAt >= 0);
    assert.ok(firstWriteAt > prepareAt);
    assert.ok(applyAt > firstWriteAt);
    assert.match(processor, /economicLedgerPlan,\s*eventType: event\.eventType,\s*previousPaymentStatus: current\.status,\s*duplicate,/);
  });

  test('obligations remain server-only and do not introduce wallet, payout or settlement execution', () => {
    const service = readFileSync('server/payments/economicObligationsService.ts', 'utf8');
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.match(service, /adminDb/);
    assert.doesNotMatch(rules, /match \/economicObligations\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
    assert.doesNotMatch(
      service,
      /walletBalance|custodialBalance|payoutInstruction|settlementAdapter|application_fee_amount|splitRecipient/i
    );
  });
});
