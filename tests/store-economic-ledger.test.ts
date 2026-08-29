import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import './economic-fees-subsidies.test';
import type { CanonicalPayment } from '../src/utils/canonicalPayment';
import type { VerifiedPaymentProviderEvent } from '../src/utils/paymentProvider';
import {
  brlToMinor,
  buildPaymentCaptureEconomicEntry,
  buildPaymentCaptureEconomicEntryId,
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
  eventId: eventType === 'payment.paid' ? 'event-paid-1' : 'event-refund-1',
  eventType,
  providerPaymentId: 'provider-pay-1',
  paymentIntentId: 'intent-1',
  amount: 29.5,
  currency: 'BRL',
  method: 'pix',
  occurredAt:
    eventType === 'payment.paid'
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
    assert.equal(capture.currency, 'BRL');
    assert.equal(capture.sourceAuthority, 'provider_webhook');
    assert.equal(capture.providerEventId, 'event-paid-1');
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

    assert.deepEqual(capture.economicAllocation, economicAllocation);
    assert.deepEqual(refund.economicAllocation, economicAllocation);
    assert.equal(capture.economicAllocation?.courierRemunerationMinor, 450);
    assert.equal(capture.economicAllocation?.storeSubsidyMinor, 500);
  });

  test('full refund is an exact opposite-sign reversal of capture', () => {
    const capture = buildPaymentCaptureEconomicEntry({
      payment: payment(),
      event: event('payment.paid'),
    });
    const refund = buildPaymentRefundEconomicEntry({
      payment: payment({ status: 'refund_processing' }),
      event: event('refund.succeeded'),
      capture,
    });
    assert.equal(refund.kind, 'payment_refund');
    assert.equal(refund.amountMinor, -2950);
    assert.equal(refund.reversalOfEntryId, capture.id);

    const summary = deriveStoreEconomicLedgerSummary([capture, refund]);
    assert.deepEqual(summary, {
      currency: 'BRL',
      capturedMinor: 2950,
      refundedMinor: 2950,
      grossAfterRefundsMinor: 0,
      entryCount: 2,
    });
  });

  test('legacy paid snapshot recovery is explicit and does not invent a webhook event', () => {
    const capture = buildRecoveredPaymentCaptureEconomicEntry({
      payment: payment(),
      paymentIntentId: 'intent-1',
    });
    assert.equal(capture.kind, 'payment_capture');
    assert.equal(capture.sourceAuthority, 'canonical_payment_snapshot');
    assert.equal(capture.providerEventId, '');
    assert.equal(capture.occurredAt, payment().paidAt);
  });

  test('event amount, method and provider must match canonical payment', () => {
    assert.throws(() =>
      buildPaymentCaptureEconomicEntry({
        payment: payment(),
        event: event('payment.paid', { amount: 30 }),
      })
    );
    assert.throws(() =>
      buildPaymentCaptureEconomicEntry({
        payment: payment(),
        event: event('payment.paid', { method: 'card' }),
      })
    );
    assert.throws(() =>
      buildPaymentCaptureEconomicEntry({
        payment: payment(),
        event: event('payment.paid', { provider: 'other_provider' }),
      })
    );
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

  test('service repairs missing historical capture before recording refund', () => {
    const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    assert.match(service, /buildRecoveredPaymentCaptureEconomicEntry/);
    assert.match(service, /if \(!captureSnapshot\.exists\)/);
    assert.match(service, /writes\.push\(\{ ref: captureRef, entry: capture \}\)/);
    assert.match(service, /buildPaymentRefundEconomicEntry/);
  });

  test('ledger remains server-only and direct Firestore browser writes are closed', () => {
    const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.match(service, /adminDb/);
    assert.doesNotMatch(rules, /match \/economicLedger\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  test('economic allocation stays separate from custody, settlement and PSP split', () => {
    const contract = readFileSync('shared/economicFeesSubsidies.ts', 'utf8');
    const ledger = readFileSync('shared/storeEconomicLedger.ts', 'utf8');
    const isolated = `${contract}\n${ledger}`;
    assert.doesNotMatch(isolated, /storePointLedger|kcoin|canonicalCash/i);
    assert.doesNotMatch(isolated, /walletBalance|custodialBalance|settlementInstruction|application_fee_amount|splitRecipient/i);
    assert.match(contract, /courierRemunerationMinor: deliveryFeeMinor/);
    assert.match(contract, /storeSubsidyMinor/);
    assert.match(contract, /kyrubIncentiveMinor/);
    assert.match(contract, /partnerSubsidyMinor/);
  });

  test('refund V1 only accepts authoritative full refund success event', () => {
    const capture = buildPaymentCaptureEconomicEntry({
      payment: payment(),
      event: event('payment.paid'),
    });
    assert.throws(() =>
      buildPaymentRefundEconomicEntry({
        payment: payment(),
        event: event('refund.processing'),
        capture,
      })
    );
  });
});
