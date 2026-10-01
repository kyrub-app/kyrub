import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import './economic-fees-subsidies.test';
import './economic-chargebacks-cancellations.test';
import './economic-obligations.test';
import './economic-obligation-eligibility.test';
import './economic-settlements.test';
import './economic-reconciliation.test';
import './economic-obligation-projections.test';
import './economic-projection-aggregates.test';
import './admin-economic-obligation-snapshot.test';
import type { CanonicalPayment } from '../src/utils/canonicalPayment';
import type { VerifiedPaymentProviderEvent } from '../src/utils/paymentProvider';
import {
  brlToMinor,
  buildPaymentCaptureEconomicEntry,
  buildPaymentCaptureEconomicEntryId,
  buildPaymentChargebackEconomicEntry,
  buildPaymentChargebackReversalEconomicEntry,
  buildPaymentRefundEconomicEntry,
  buildPaymentRefundEconomicEntryId,
  buildRecoveredPaymentCaptureEconomicEntry,
  deriveStoreEconomicLedgerSummary,
  storeEconomicLedgerEntryPath,
} from '../shared/storeEconomicLedger';
import { buildMarketplaceEconomicAllocationSnapshot } from '../shared/economicFeesSubsidies';

const payment = (overrides: Partial<CanonicalPayment> = {}): CanonicalPayment => ({
  id: 'pay-1',
  storeId: 'store-1',
  orderId: 'order-1',
  buyerId: 'buyer-1',
  amount: 29.5,
  currency: 'BRL',
  method: 'pix',
  context: 'marketplace',
  status: 'paid',
  provider: 'mercado_pago',
  providerPaymentId: 'provider-pay-1',
  idempotencyKey: 'payment-key-1',
  createdAt: '2026-08-29T10:00:00.000Z',
  updatedAt: '2026-08-29T10:01:00.000Z',
  paidAt: '2026-08-29T10:01:00.000Z',
  refundedAt: '',
  ...overrides,
});

const event = (
  eventType: VerifiedPaymentProviderEvent['eventType'],
  overrides: Partial<VerifiedPaymentProviderEvent> = {}
): VerifiedPaymentProviderEvent => ({
  provider: 'mercado_pago',
  eventId: `event-${eventType}`,
  eventType,
  providerPaymentId: 'provider-pay-1',
  paymentIntentId: 'intent-1',
  amount: 29.5,
  currency: 'BRL',
  method: 'pix',
  occurredAt: eventType === 'payment.paid'
    ? '2026-08-29T10:01:00.000Z'
    : '2026-08-29T11:00:00.000Z',
  signatureVerified: true,
  ...overrides,
});

describe('store economic ledger', () => {
  test('money is converted to integer BRL minor units', () => {
    assert.equal(brlToMinor(29.5), 2950);
    assert.equal(brlToMinor(0.01), 1);
    assert.equal(brlToMinor(10.239), 1024);
    assert.throws(() => brlToMinor(0));
    assert.throws(() => brlToMinor(Number.NaN));
  });

  test('capture and refund ids are deterministic and tenant scoped', () => {
    const captureId = buildPaymentCaptureEconomicEntryId('pay-1');
    const refundId = buildPaymentRefundEconomicEntryId('pay-1');
    assert.equal(captureId, 'payment:capture:pay-1');
    assert.equal(refundId, 'payment:refund:pay-1');
    assert.equal(
      storeEconomicLedgerEntryPath('store-1', captureId),
      'stores/store-1/economicLedger/payment%3Acapture%3Apay-1'
    );
  });

  test('verified paid event creates positive gross capture', () => {
    const capture = buildPaymentCaptureEconomicEntry({
      payment: payment(),
      event: event('payment.paid'),
    });
    assert.equal(capture.kind, 'payment_capture');
    assert.equal(capture.amountMinor, 2950);
    assert.equal(capture.sourceAuthority, 'provider_webhook');
    assert.equal(capture.reversalOfEntryId, '');
  });

  test('capture persists immutable economic allocation and refund references the same facts', () => {
    const economicAllocation = buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 30,
      discountTotal: 5,
      deliveryFee: 4.5,
      total: 29.5,
    });
    const capture = buildPaymentCaptureEconomicEntry({
      payment: payment(),
      event: event('payment.paid'),
      economicAllocation,
    });
    const refund = buildPaymentRefundEconomicEntry({
      payment: payment({ status: 'refund_processing' }),
      event: event('refund.succeeded'),
      capture,
    });
    assert.deepEqual(refund.economicAllocation, economicAllocation);
    assert.equal(capture.economicAllocation?.courierRemunerationMinor, 450);
  });

  test('full refund remains an exact opposite-sign reversal of capture', () => {
    const capture = buildPaymentCaptureEconomicEntry({ payment: payment(), event: event('payment.paid') });
    const refund = buildPaymentRefundEconomicEntry({
      payment: payment({ status: 'refund_processing' }),
      event: event('refund.succeeded'),
      capture,
    });
    const summary = deriveStoreEconomicLedgerSummary([capture, refund]);
    assert.deepEqual(summary, {
      currency: 'BRL',
      capturedMinor: 2950,
      refundedMinor: 2950,
      grossAfterRefundsMinor: 0,
      chargedBackMinor: 0,
      chargebackReversedMinor: 0,
      economicNetMinor: 0,
      entryCount: 2,
    });
  });

  test('chargeback debit is separate from refund and its reversal restores economic net', () => {
    const allocation = buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 30,
      discountTotal: 5,
      deliveryFee: 4.5,
      total: 29.5,
    });
    const capture = buildPaymentCaptureEconomicEntry({
      payment: payment(),
      event: event('payment.paid'),
      economicAllocation: allocation,
    });
    const chargeback = buildPaymentChargebackEconomicEntry({
      payment: payment(),
      event: event('chargeback.debited'),
      capture,
    });
    const reversal = buildPaymentChargebackReversalEconomicEntry({
      payment: payment({ status: 'charged_back' }),
      event: event('chargeback.reversed'),
      chargeback,
    });

    assert.equal(chargeback.kind, 'payment_chargeback');
    assert.equal(chargeback.amountMinor, -2950);
    assert.equal(chargeback.reversalOfEntryId, capture.id);
    assert.deepEqual(chargeback.economicAllocation, allocation);
    assert.equal(reversal.kind, 'payment_chargeback_reversal');
    assert.equal(reversal.amountMinor, 2950);
    assert.equal(reversal.reversalOfEntryId, chargeback.id);
    assert.deepEqual(reversal.economicAllocation, allocation);

    const summary = deriveStoreEconomicLedgerSummary([capture, chargeback, reversal]);
    assert.equal(summary.grossAfterRefundsMinor, 2950);
    assert.equal(summary.chargedBackMinor, 2950);
    assert.equal(summary.chargebackReversedMinor, 2950);
    assert.equal(summary.economicNetMinor, 2950);
  });

  test('legacy paid snapshot recovery is explicit and does not invent a webhook event', () => {
    const capture = buildRecoveredPaymentCaptureEconomicEntry({
      payment: payment(),
      paymentIntentId: 'intent-1',
    });
    assert.equal(capture.kind, 'payment_capture');
    assert.equal(capture.sourceAuthority, 'canonical_payment_snapshot');
    assert.equal(capture.providerEventId, '');
  });

  test('event amount, method and provider must match canonical payment', () => {
    assert.throws(() => buildPaymentCaptureEconomicEntry({ payment: payment(), event: event('payment.paid', { amount: 30 }) }));
    assert.throws(() => buildPaymentCaptureEconomicEntry({ payment: payment(), event: event('payment.paid', { method: 'card' }) }));
    assert.throws(() => buildPaymentCaptureEconomicEntry({ payment: payment(), event: event('payment.paid', { provider: 'other_provider' }) }));
  });

  test('webhook prepares economic ledger before writes and applies it in the same transaction', () => {
    const processor = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');
    const prepareAt = processor.indexOf('prepareStoreEconomicLedgerPaymentPlan');
    const firstPaymentWriteAt = processor.indexOf('transaction.update(intentRef');
    assert.ok(prepareAt >= 0);
    assert.ok(firstPaymentWriteAt > prepareAt);
    assert.match(processor, /applyStoreEconomicLedgerPaymentPlan\(transaction, economicLedgerPlan\)/);
    assert.match(processor, /payment: current,\s*event,/);
  });

  test('service recovers capture before either refund or chargeback economic reversal', () => {
    const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    assert.match(service, /buildRecoveredPaymentCaptureEconomicEntry/);
    assert.match(service, /buildPaymentRefundEconomicEntry/);
    assert.match(service, /buildPaymentChargebackEconomicEntry/);
    assert.match(service, /buildPaymentChargebackReversalEconomicEntry/);
  });

  test('ledger remains server-only and direct Firestore browser writes are closed', () => {
    const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.match(service, /adminDb/);
    assert.doesNotMatch(rules, /match \/economicLedger\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  test('economic lifecycle remains separate from custody, settlement and PSP split', () => {
    const ledger = readFileSync('shared/storeEconomicLedger.ts', 'utf8');
    assert.doesNotMatch(ledger, /walletBalance|custodialBalance|settlementInstruction|application_fee_amount|splitRecipient/i);
    assert.match(ledger, /payment_chargeback/);
    assert.match(ledger, /payment_chargeback_reversal/);
  });

  test('refund still only accepts authoritative full refund success event', () => {
    const capture = buildPaymentCaptureEconomicEntry({ payment: payment(), event: event('payment.paid') });
    assert.throws(() => buildPaymentRefundEconomicEntry({
      payment: payment(),
      event: event('refund.processing'),
      capture,
    }));
  });

  test('historical profitability pagination is deterministic, bounded and tenant-bound', () => {
    const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    assert.match(service, /orderBy\('occurredAt', 'desc'\)[\s\S]*?orderBy\(FieldPath\.documentId\(\), 'desc'\)/);
    assert.match(service, /query\.limit\(requestedLimit \+ 1\)/);
    assert.match(service, /startAfter\(cursor\.occurredAt, cursor\.documentId\)/);
    assert.match(service, /storeId,[\s\S]*?occurredAt:[\s\S]*?documentId:/);
    assert.match(service, /requestedLimit > 50/);
  });

  test('backfill re-reads the complete order ledger before either profitability projection', () => {
    const service = readFileSync('server/payments/storeProfitabilityBackfillService.ts', 'utf8');
    const fullLedgerAt = service.indexOf('listStoreEconomicLedgerEntriesForOrder');
    const orderAt = service.indexOf('reconcileStoreOrderProfitabilityForOrder({', fullLedgerAt);
    const productAt = service.indexOf('reconcileStoreProductProfitabilityForOrder({', orderAt);
    assert.ok(fullLedgerAt >= 0);
    assert.ok(orderAt > fullLedgerAt);
    assert.ok(productAt > orderAt);
    assert.match(service, /economicEntries: completeEconomicEntries/);
  });

  test('product profitability prefers immutable commercial snapshots and frozen margin targets', () => {
    const service = readFileSync('server/payments/storeProductProfitabilityService.ts', 'utf8');
    const snapshotAt = service.indexOf('orderCommercialSnapshotPath');
    const legacyAt = service.indexOf('artifacts/${inventoryEvidence.tenantId}', snapshotAt);
    assert.ok(snapshotAt >= 0);
    assert.ok(legacyAt > snapshotAt);
    assert.match(service, /Object\.prototype\.hasOwnProperty\.call\(commercialSnapshot, 'marginTargets'\)/);
    assert.match(service, /hasFrozenMarginTargets[\s\S]*?parseFrozenMarginTargets/);
    assert.match(service, /!hasFrozenMarginTargets[\s\S]*?historicalTargets/);
  });

  test('backfill endpoint stays owner-only and retries remain fingerprint-idempotent', () => {
    const router = readFileSync('server/payments/storeOrderProfitabilityRouter.ts', 'utf8');
    const orderService = readFileSync('server/payments/storeOrderProfitabilityService.ts', 'utf8');
    const productService = readFileSync('server/payments/storeProductProfitabilityService.ts', 'utf8');
    const routeAt = router.indexOf("router.post('/backfill'");
    const ownerAt = router.indexOf('await requireOwner', routeAt);
    const backfillAt = router.indexOf('backfillStoreProfitabilityPage', ownerAt);
    assert.ok(routeAt >= 0);
    assert.ok(ownerAt > routeAt);
    assert.ok(backfillAt > ownerAt);
    assert.match(orderService, /if \(!stableCalculatedAt\) \{\s*await ref\.set/);
    assert.match(productService, /existing\.sourceFingerprint !== sourceFingerprint/);
  });
});